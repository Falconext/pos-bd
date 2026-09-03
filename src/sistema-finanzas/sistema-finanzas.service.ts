import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SistemaFinanzasService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Brand scope resolver ───────────────────────────────────────────────────
  // ADMIN_SISTEMA → usa sistemaNegocio del JWT (null = ve todo).
  // ADMIN_EMPRESA → deriva brand de su empresa.
  private async resolveScope(
    sistemaNegocio: string | null | undefined,
    sistemaProducto: string | null | undefined,
    empresaId?: number | null,
    rol?: string,
  ): Promise<{ sn: string | null; sp: string | null }> {
    let sn = sistemaNegocio ?? null;
    const sp = sistemaProducto ?? null;
    if (rol === 'ADMIN_EMPRESA' && empresaId) {
      const emp = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { brand: true },
      });
      sn = emp?.brand ?? null;
    }
    return { sn, sp };
  }

  // RUCs excluidos de las métricas financieras (empresa propia de Krezka + internas).
  private readonly RUCS_EXCLUIDOS = [
    '10479465750',
    '20524076307',
    '20616318773',
  ];

  // Excluye de las métricas financieras: clientes DEMO/prueba (mismo criterio que la
  // pantalla de Empresas: plan.esPrueba OR usaDemo OR nombre "demo/prueba"), RUCs
  // internos, y —cuando vencidos=true— las suscripciones vencidas (fechaExpiracion
  // ya pasada). Los inactivos ya se filtran aparte con estado='ACTIVO'.
  private excluirWhere(ahora: Date, opts?: { vencidos?: boolean }) {
    const or: any[] = [
      { ruc: { in: this.RUCS_EXCLUIDOS } },
      { usaDemo: true },
      { plan: { esPrueba: true } },
      { plan: { nombre: { contains: 'demo', mode: 'insensitive' as const } } },
      { plan: { nombre: { contains: 'prueba', mode: 'insensitive' as const } } },
    ];
    if (opts?.vencidos) or.push({ fechaExpiracion: { lt: ahora } });
    return { NOT: { OR: or } };
  }

  // ── DASHBOARD KPIs ─────────────────────────────────────────────────────────

  async getDashboard(
    sistemaNegocio?: string | null,
    sistemaProducto?: string | null,
    empresaId?: number | null,
    rol?: string,
  ) {
    const { sn: resolvedSN, sp: resolvedSP } = await this.resolveScope(
      sistemaNegocio,
      sistemaProducto,
      empresaId,
      rol,
    );
    sistemaNegocio = resolvedSN;
    sistemaProducto = resolvedSP;
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const inicioAnio = new Date(ahora.getFullYear(), 0, 1);
    const hace12Meses = new Date(ahora.getFullYear(), ahora.getMonth() - 11, 1);

    // Filtros de alcance del admin (plataforma + producto)
    const empresaScopeWhere: any = {};
    if (sistemaNegocio) empresaScopeWhere.brand = sistemaNegocio.toLowerCase();
    if (sistemaProducto)
      empresaScopeWhere.producto = sistemaProducto.toLowerCase();
    // Solo clientes de pago: excluye demos/prueba, RUCs internos y vencidos.
    const empresaPagaWhere: any = {
      ...empresaScopeWhere,
      ...this.excluirWhere(ahora, { vencidos: true }),
    };

    // Empresas activas con su plan
    const empresasParaMRR = await this.prisma.empresa.findMany({
      where: { estado: 'ACTIVO', ...empresaPagaWhere },
      select: {
        id: true,
        fechaExpiracion: true,
        plan: { select: { costo: true, nombre: true } },
      },
    });

    const mrr = empresasParaMRR.reduce(
      (s, e) => s + Number(e.plan?.costo ?? 0),
      0,
    );
    const arr = mrr * 12;

    // Ingresos cobrados este mes — filtrados por empresas del sistema
    const empresaIds = empresasParaMRR.map((e) => e.id);
    const movimientoWhere =
      empresaIds.length > 0 && (sistemaNegocio || sistemaProducto)
        ? { empresaId: { in: empresaIds } }
        : {};

    const [ingresosMes, ingresosAnio] = await Promise.all([
      this.prisma.resellerMovimiento.aggregate({
        where: {
          tipo: { in: ['MENSUALIDAD', 'ACTIVACION'] },
          estado: 'APLICADO',
          fecha: { gte: inicioMes },
          ...movimientoWhere,
        },
        _sum: { monto: true },
      }),
      this.prisma.resellerMovimiento.aggregate({
        where: {
          tipo: { in: ['MENSUALIDAD', 'ACTIVACION'] },
          estado: 'APLICADO',
          fecha: { gte: inicioAnio },
          ...movimientoWhere,
        },
        _sum: { monto: true },
      }),
    ]);

    // Gastos del sistema (globales — no filtrados por brand)
    const [gastosMes, gastosAnio] = await Promise.all([
      this.prisma.gastoSistema.aggregate({
        where: { fecha: { gte: inicioMes } },
        _sum: { monto: true },
      }),
      this.prisma.gastoSistema.aggregate({
        where: { fecha: { gte: inicioAnio } },
        _sum: { monto: true },
      }),
    ]);

    const ingMes = Number(ingresosMes._sum.monto ?? 0);
    const ingAnio = Number(ingresosAnio._sum.monto ?? 0);
    const gastMes = Number(gastosMes._sum.monto ?? 0);
    const gastAnio = Number(gastosAnio._sum.monto ?? 0);

    // Clientes: nuevos este mes vs mes anterior
    const inicioMesAnterior = new Date(
      ahora.getFullYear(),
      ahora.getMonth() - 1,
      1,
    );
    const [nuevosEsteMes, nuevosMesAnterior, totalActivos, totalInactivos] =
      await Promise.all([
        this.prisma.empresa.count({
          where: { fechaActivacion: { gte: inicioMes }, ...empresaPagaWhere },
        }),
        this.prisma.empresa.count({
          where: {
            fechaActivacion: { gte: inicioMesAnterior, lt: inicioMes },
            ...empresaPagaWhere,
          },
        }),
        this.prisma.empresa.count({
          where: { estado: 'ACTIVO', ...empresaPagaWhere },
        }),
        this.prisma.empresa.count({
          where: { estado: { not: 'ACTIVO' }, ...empresaPagaWhere },
        }),
      ]);

    // Próximas a vencer (7 días)
    const en7Dias = new Date();
    en7Dias.setDate(en7Dias.getDate() + 7);
    const proximasVencer = await this.prisma.empresa.count({
      where: {
        estado: 'ACTIVO',
        fechaExpiracion: { lte: en7Dias, gte: ahora },
        ...empresaPagaWhere,
      },
    });

    // Distribución de clientes por plan (solo clientes de pago)
    const porPlan = await this.prisma.empresa.groupBy({
      by: ['planId'],
      where: { estado: 'ACTIVO', ...empresaPagaWhere },
      _count: true,
    });
    const planes = await this.prisma.plan.findMany({
      select: { id: true, nombre: true, costo: true },
    });
    const distribucionPlanes = porPlan.map((p) => {
      const plan = planes.find((pl) => pl.id === p.planId);
      return {
        nombre: plan?.nombre ?? 'Sin plan',
        count: p._count,
        costo: Number(plan?.costo ?? 0),
      };
    });

    // Lista de empresas activas con su admin principal (solo clientes de pago)
    const empresasActivas = await this.prisma.empresa.findMany({
      where: { estado: 'ACTIVO', ...empresaPagaWhere },
      select: {
        id: true,
        razonSocial: true,
        nombreComercial: true,
        ruc: true,
        fechaActivacion: true,
        fechaExpiracion: true,
        logo: true,
        brand: true,
        plan: { select: { nombre: true, costo: true } },
        usuarios: {
          where: { rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
          select: { nombre: true, email: true },
          take: 1,
        },
      },
      orderBy: { razonSocial: 'asc' },
    });

    // Ingresos rechazados este mes (fallidos)
    const rechazadosMes = await this.prisma.resellerMovimiento.aggregate({
      where: {
        tipo: 'MENSUALIDAD',
        estado: 'RECHAZADO',
        fecha: { gte: inicioMes },
        ...movimientoWhere,
      },
      _sum: { monto: true },
      _count: true,
    });

    return {
      mrr,
      arr,
      ingMes,
      ingAnio,
      gastMes,
      gastAnio,
      gananciaNetaMes: ingMes - gastMes,
      gananciaNetaAnio: ingAnio - gastAnio,
      margenMes: ingMes > 0 ? ((ingMes - gastMes) / ingMes) * 100 : 0,
      totalActivos,
      totalInactivos,
      nuevosEsteMes,
      nuevosMesAnterior,
      crecimientoClientes:
        nuevosMesAnterior > 0
          ? ((nuevosEsteMes - nuevosMesAnterior) / nuevosMesAnterior) * 100
          : 0,
      proximasVencer,
      distribucionPlanes,
      rechazadosMes: {
        monto: Number(rechazadosMes._sum.monto ?? 0),
        count: rechazadosMes._count,
      },
      inicio12Meses: hace12Meses.toISOString(),
      empresasActivas: empresasActivas.map((e) => ({
        id: e.id,
        nombre: e.nombreComercial || e.razonSocial,
        ruc: e.ruc,
        plan: e.plan?.nombre ?? '—',
        costoMensual: Number(e.plan?.costo ?? 0),
        admin: e.usuarios[0]
          ? `${e.usuarios[0].nombre} (${e.usuarios[0].email})`
          : '—',
        adminEmail: e.usuarios[0]?.email ?? null,
        fechaActivacion: e.fechaActivacion,
        fechaExpiracion: e.fechaExpiracion,
        logo: e.logo,
      })),
    };
  }

  // ── TENDENCIA MENSUAL (últimos N meses) ────────────────────────────────────

  async getTendencia(
    meses = 12,
    sistemaNegocio?: string | null,
    sistemaProducto?: string | null,
    empresaId?: number | null,
    rol?: string,
  ) {
    const { sn: resolvedSN, sp: resolvedSP } = await this.resolveScope(
      sistemaNegocio,
      sistemaProducto,
      empresaId,
      rol,
    );
    sistemaNegocio = resolvedSN;
    sistemaProducto = resolvedSP;

    const ahora = new Date();
    const resultado: any[] = [];
    const empresaScopeWhere: any = {};
    if (sistemaNegocio) empresaScopeWhere.brand = sistemaNegocio.toLowerCase();
    if (sistemaProducto)
      empresaScopeWhere.producto = sistemaProducto.toLowerCase();

    // IDs de empresas del sistema para filtrar movimientos
    const empresasDelSistema =
      sistemaNegocio || sistemaProducto
        ? await this.prisma.empresa.findMany({
            where: empresaScopeWhere,
            select: { id: true },
          })
        : [];
    const movimientoWhere =
      (sistemaNegocio || sistemaProducto) && empresasDelSistema.length > 0
        ? { empresaId: { in: empresasDelSistema.map((e) => e.id) } }
        : {};

    for (let i = meses - 1; i >= 0; i--) {
      const ini = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      const fin = new Date(
        ahora.getFullYear(),
        ahora.getMonth() - i + 1,
        0,
        23,
        59,
        59,
      );

      const [ingresos, gastos, nuevosClientes, bajasClientes] =
        await Promise.all([
          this.prisma.resellerMovimiento.aggregate({
            where: {
              tipo: { in: ['MENSUALIDAD', 'ACTIVACION'] },
              estado: 'APLICADO',
              fecha: { gte: ini, lte: fin },
              ...movimientoWhere,
            },
            _sum: { monto: true },
          }),
          this.prisma.gastoSistema.aggregate({
            where: { fecha: { gte: ini, lte: fin } },
            _sum: { monto: true },
          }),
          this.prisma.empresa.count({
            where: {
              fechaActivacion: { gte: ini, lte: fin },
              ...empresaScopeWhere,
              ...this.excluirWhere(ahora, { vencidos: false }),
            },
          }),
          this.prisma.empresa.count({
            where: {
              estado: 'INACTIVO',
              fechaExpiracion: { gte: ini, lte: fin },
              ...empresaScopeWhere,
              ...this.excluirWhere(ahora, { vencidos: false }),
            },
          }),
        ]);

      const ing = Number(ingresos._sum.monto ?? 0);
      const gas = Number(gastos._sum.monto ?? 0);
      resultado.push({
        mes: ini.toLocaleDateString('es-PE', {
          month: 'short',
          year: '2-digit',
        }),
        mesIso: ini.toISOString(),
        ingresos: ing,
        gastos: gas,
        ganancia: ing - gas,
        nuevosClientes,
        bajasClientes,
      });
    }

    return resultado;
  }

  // ── PROYECCIÓN DE INGRESO RECURRENTE (MRR) ─────────────────────────────────
  // Proyecta la posible ganancia recurrente mes a mes hacia adelante, a partir
  // del MRR actual (Σ costo del plan de empresas activas) y el crecimiento neto
  // histórico (promedio de altas − bajas por mes). Es una ESTIMACIÓN, no cobros.
  async getProyeccion(
    mesesFuturos = 6,
    histMeses = 6,
    sistemaNegocio?: string | null,
    sistemaProducto?: string | null,
    empresaId?: number | null,
    rol?: string,
  ) {
    const { sn, sp } = await this.resolveScope(
      sistemaNegocio,
      sistemaProducto,
      empresaId,
      rol,
    );
    const scope: any = {};
    if (sn) scope.brand = sn.toLowerCase();
    if (sp) scope.producto = sp.toLowerCase();

    // MRR actual + empresas activas + ticket promedio (solo clientes de pago, sin demos)
    const activas = await this.prisma.empresa.findMany({
      where: {
        estado: 'ACTIVO',
        ...scope,
        ...this.excluirWhere(new Date(), { vencidos: true }),
      },
      select: { plan: { select: { costo: true } } },
    });
    const empresasActivas = activas.length;
    const mrrActual = activas.reduce(
      (s, e) => s + Number(e.plan?.costo ?? 0),
      0,
    );
    const ticketPromedio =
      empresasActivas > 0 ? mrrActual / empresasActivas : 0;

    // Historial de altas/bajas por mes → promedios
    const hist = await this.getTendencia(histMeses, sn, sp, empresaId, rol);
    const n = hist.length || 1;
    const avgNuevos =
      hist.reduce((s, m: any) => s + Number(m.nuevosClientes || 0), 0) / n;
    const avgBajas =
      hist.reduce((s, m: any) => s + Number(m.bajasClientes || 0), 0) / n;
    const netoMensual = avgNuevos - avgBajas;
    const churnRate = empresasActivas > 0 ? avgBajas / empresasActivas : 0;

    const round2 = (x: number) => Math.round(x * 100) / 100;
    const ahora = new Date();

    let activos = empresasActivas;
    let acumulado = 0;
    const proyeccion: any[] = [];
    for (let k = 1; k <= mesesFuturos; k++) {
      const nuevos = Math.round(avgNuevos);
      const bajas = Math.round(avgBajas);
      activos = Math.max(0, activos + nuevos - bajas);
      const mrrProyectado = round2(activos * ticketPromedio);
      acumulado = round2(acumulado + mrrProyectado);
      const fecha = new Date(ahora.getFullYear(), ahora.getMonth() + k, 1);
      proyeccion.push({
        mes: fecha.toLocaleDateString('es-PE', {
          month: 'short',
          year: '2-digit',
        }),
        mesIso: fecha.toISOString(),
        mrrProyectado,
        activos,
        nuevos,
        bajas,
        acumulado,
      });
    }

    // Punto 0 = mes actual (base), para que la curva arranque en el MRR real.
    const base = {
      mes: ahora.toLocaleDateString('es-PE', {
        month: 'short',
        year: '2-digit',
      }),
      mesIso: new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        1,
      ).toISOString(),
      mrrProyectado: round2(mrrActual),
      activos: empresasActivas,
      nuevos: 0,
      bajas: 0,
      acumulado: 0,
      esActual: true,
    };

    return {
      mrrActual: round2(mrrActual),
      empresasActivas,
      ticketPromedio: round2(ticketPromedio),
      avgNuevos: round2(avgNuevos),
      avgBajas: round2(avgBajas),
      netoMensual: round2(netoMensual),
      churnRate: round2(churnRate * 100), // %
      mesesFuturos,
      mrrProyectadoFinal:
        proyeccion.length > 0
          ? proyeccion[proyeccion.length - 1].mrrProyectado
          : round2(mrrActual),
      gananciaAcumulada: acumulado,
      serie: [base, ...proyeccion],
    };
  }

  // ── GASTOS CRUD ────────────────────────────────────────────────────────────

  async listarGastos(params: {
    desde?: string;
    hasta?: string;
    categoria?: string;
  }) {
    const where: any = {};
    if (params.desde || params.hasta) {
      where.fecha = {};
      if (params.desde) where.fecha.gte = new Date(params.desde);
      if (params.hasta) where.fecha.lte = new Date(params.hasta + 'T23:59:59');
    }
    if (params.categoria) where.categoria = params.categoria;

    const [gastos, total] = await Promise.all([
      this.prisma.gastoSistema.findMany({ where, orderBy: { fecha: 'desc' } }),
      this.prisma.gastoSistema.aggregate({
        where,
        _sum: { monto: true },
        _count: true,
      }),
    ]);

    return {
      gastos: gastos.map((g) => ({ ...g, monto: Number(g.monto) })),
      totalMonto: Number(total._sum.monto ?? 0),
      totalItems: total._count,
    };
  }

  async crearGasto(dto: {
    concepto: string;
    categoria: string;
    monto: number;
    fecha: string;
    descripcion?: string;
    recurrente?: boolean;
    periodicidad?: string;
  }) {
    const gasto = await this.prisma.gastoSistema.create({
      data: {
        concepto: dto.concepto,
        categoria: dto.categoria,
        monto: dto.monto,
        fecha: new Date(dto.fecha),
        descripcion: dto.descripcion,
        recurrente: dto.recurrente ?? false,
        periodicidad: dto.periodicidad,
      },
    });
    return { ...gasto, monto: Number(gasto.monto) };
  }

  async actualizarGasto(
    id: number,
    dto: Partial<{
      concepto: string;
      categoria: string;
      monto: number;
      fecha: string;
      descripcion: string;
      recurrente: boolean;
      periodicidad: string;
    }>,
  ) {
    const existe = await this.prisma.gastoSistema.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Gasto no encontrado');

    const data: any = { ...dto };
    if (dto.fecha) data.fecha = new Date(dto.fecha);

    const gasto = await this.prisma.gastoSistema.update({
      where: { id },
      data,
    });
    return { ...gasto, monto: Number(gasto.monto) };
  }

  async eliminarGasto(id: number) {
    const existe = await this.prisma.gastoSistema.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Gasto no encontrado');
    await this.prisma.gastoSistema.delete({ where: { id } });
    return { ok: true };
  }

  // ── INGRESOS CRUD ──────────────────────────────────────────────────────────

  async listarIngresos(params: {
    desde?: string;
    hasta?: string;
    tipo?: string;
  }) {
    const where: any = {};
    if (params.desde || params.hasta) {
      where.fecha = {};
      if (params.desde) where.fecha.gte = new Date(params.desde);
      if (params.hasta) where.fecha.lte = new Date(params.hasta + 'T23:59:59');
    }
    if (params.tipo) where.tipo = params.tipo;

    const [ingresos, total] = await Promise.all([
      this.prisma.ingresoSistema.findMany({
        where,
        orderBy: { fecha: 'desc' },
      }),
      this.prisma.ingresoSistema.aggregate({
        where,
        _sum: { monto: true },
        _count: true,
      }),
    ]);

    return {
      ingresos: ingresos.map((i) => ({ ...i, monto: Number(i.monto) })),
      totalMonto: Number(total._sum.monto ?? 0),
      totalItems: total._count,
    };
  }

  async crearIngreso(dto: {
    concepto: string;
    tipo: string;
    monto: number;
    fecha: string;
    descripcion?: string;
  }) {
    const ingreso = await this.prisma.ingresoSistema.create({
      data: {
        concepto: dto.concepto,
        tipo: dto.tipo,
        monto: dto.monto,
        fecha: new Date(dto.fecha),
        descripcion: dto.descripcion,
      },
    });
    return { ...ingreso, monto: Number(ingreso.monto) };
  }

  async actualizarIngreso(
    id: number,
    dto: Partial<{
      concepto: string;
      tipo: string;
      monto: number;
      fecha: string;
      descripcion: string;
    }>,
  ) {
    const existe = await this.prisma.ingresoSistema.findUnique({
      where: { id },
    });
    if (!existe) throw new NotFoundException('Ingreso no encontrado');

    const data: any = { ...dto };
    if (dto.fecha) data.fecha = new Date(dto.fecha);

    const ingreso = await this.prisma.ingresoSistema.update({
      where: { id },
      data,
    });
    return { ...ingreso, monto: Number(ingreso.monto) };
  }

  async eliminarIngreso(id: number) {
    const existe = await this.prisma.ingresoSistema.findUnique({
      where: { id },
    });
    if (!existe) throw new NotFoundException('Ingreso no encontrado');
    await this.prisma.ingresoSistema.delete({ where: { id } });
    return { ok: true };
  }
}
