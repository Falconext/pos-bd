import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import {
  diasGraciaSuscripcion,
  evaluarGracia,
} from '../common/utils/gracia-suscripcion';

/**
 * El ciclo de cobro de las empresas que le compran directo a Falconext.
 *
 * Son tres momentos distintos y conviene no mezclarlos:
 *
 *  1. `generarCobrosDelCiclo` emite lo que se debe, unos días ANTES de que
 *     venza, para que el empresario tenga tiempo de pagar. Emitir no cobra ni
 *     extiende nada.
 *  2. `registrarPago` confirma que entró la plata: recién ahí se extiende la
 *     suscripción y queda el ingreso en finanzas. Hoy lo ejecuta un
 *     administrador; cuando se conecte Mercado Pago lo llamará el webhook con
 *     la misma firma, sin tocar el resto.
 *  3. `procesarVencidos` se ocupa de los que no pagaron: avisa durante los días
 *     de gracia y suspende cuando se acaban.
 *
 * Los clientes de reseller NO pasan por acá: su ciclo ya vive en
 * `ResellerService.processMonthlyRenewals`, que descuenta del saldo del
 * reseller. Mezclarlos cobraría dos veces.
 */
@Injectable()
export class CobroEmpresaService {
  private readonly logger = new Logger(CobroEmpresaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /** Con cuántos días de anticipación se emite la mensualidad. */
  private diasAnticipacion(): number {
    const raw = Number(process.env.SUSCRIPCION_ANTICIPACION_DIAS ?? 5);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 5;
  }

  /** "2026-10" — el mes que cubre el cobro, tomado del vencimiento. */
  private periodoDe(fecha: Date): string {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Las empresas que entran al ciclo: clientes directos y de pago.
   *
   * Quedan fuera los clientes de reseller (su ciclo es otro), las demos (su
   * fechaExpiracion es el fin de la prueba, no un periodo pagado) y los planes
   * de costo cero, que no hay nada que cobrarles.
   */
  private get filtroEmpresasDeCobro(): Prisma.EmpresaWhereInput {
    return {
      resellerId: null,
      usaDemo: false,
      estado: { in: ['ACTIVO', 'INACTIVO'] },
    };
  }

  // ── 1. Emitir ────────────────────────────────────────────────────────────

  async generarCobrosDelCiclo(ahora: Date = new Date()) {
    const limite = new Date(ahora);
    limite.setDate(limite.getDate() + this.diasAnticipacion());

    const empresas = await this.prisma.empresa.findMany({
      where: {
        ...this.filtroEmpresasDeCobro,
        fechaExpiracion: { lte: limite },
      },
      select: {
        id: true,
        razonSocial: true,
        fechaExpiracion: true,
        plan: { select: { nombre: true, costo: true } },
      },
      orderBy: { fechaExpiracion: 'asc' },
    });

    let emitidos = 0;
    let omitidos = 0;

    for (const empresa of empresas) {
      const monto = Number(empresa.plan?.costo ?? 0);
      if (monto <= 0) {
        omitidos += 1;
        continue;
      }
      const periodo = this.periodoDe(empresa.fechaExpiracion);
      try {
        const cobro = await this.prisma.cobroEmpresa.create({
          data: {
            empresaId: empresa.id,
            periodo,
            planNombre: empresa.plan?.nombre ?? null,
            monto: new Decimal(monto),
            estado: 'PENDIENTE',
            fechaVencimiento: empresa.fechaExpiracion,
            descripcion: `Mensualidad ${periodo} — ${empresa.plan?.nombre ?? 'plan'}`,
          },
        });
        emitidos += 1;
        await this.avisarAdmins(empresa.id, {
          tipo: 'INFO',
          titulo: 'Mensualidad emitida',
          mensaje: `Se emitió tu mensualidad de ${periodo} por S/ ${monto.toFixed(2)}. Vence el ${empresa.fechaExpiracion.toLocaleDateString('es-PE')}.`,
        });
        this.logger.log(
          `Cobro ${cobro.id} emitido a empresa ${empresa.id} (${periodo})`,
        );
      } catch (e: any) {
        // El único índice que puede chocar es [empresaId, periodo]: ya se emitió
        // este mes. Es el caso normal cuando el cron corre a diario, no un error.
        if (e?.code === 'P2002') {
          omitidos += 1;
          continue;
        }
        this.logger.error(
          `No se pudo emitir el cobro de la empresa ${empresa.id}: ${e?.message}`,
        );
      }
    }

    return { evaluadas: empresas.length, emitidos, omitidos };
  }

  // ── 2. Confirmar el pago ─────────────────────────────────────────────────

  /**
   * Da por pagada una mensualidad y extiende la suscripción.
   *
   * La extensión parte del vencimiento vigente, no de hoy: quien paga con tres
   * días de atraso no pierde esos tres días, y quien paga adelantado tampoco
   * regala tiempo. Solo si el vencimiento ya quedó muy atrás (más que la
   * gracia) se cuenta desde hoy, porque ahí la cuenta estuvo suspendida.
   */
  async registrarPago(
    cobroId: number,
    datos: {
      medioPago?: string;
      referencia?: string;
      fechaCobro?: Date;
      monto?: number;
      usuarioId?: number;
    } = {},
  ) {
    const cobro = await this.prisma.cobroEmpresa.findUnique({
      where: { id: cobroId },
      include: {
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            fechaExpiracion: true,
            estado: true,
            planId: true,
            plan: { select: { nombre: true, duracionDias: true } },
          },
        },
      },
    });
    if (!cobro) throw new NotFoundException('Cobro no encontrado');
    if (cobro.estado === 'APLICADO') {
      throw new BadRequestException('Este cobro ya figura como pagado');
    }
    if (cobro.estado === 'ANULADO') {
      throw new BadRequestException('Este cobro está anulado');
    }

    const ahora = datos.fechaCobro ?? new Date();
    const dias = cobro.empresa.plan?.duracionDias || 30;
    const vencimiento = cobro.empresa.fechaExpiracion;
    const limiteParaEncadenar = new Date(vencimiento);
    limiteParaEncadenar.setDate(
      limiteParaEncadenar.getDate() + diasGraciaSuscripcion(),
    );
    const base =
      limiteParaEncadenar >= ahora ? new Date(vencimiento) : new Date(ahora);
    const cubreHasta = new Date(base);
    cubreHasta.setDate(cubreHasta.getDate() + dias);

    const monto =
      datos.monto != null ? Number(datos.monto) : Number(cobro.monto);

    const resultado = await this.prisma.$transaction(async (tx) => {
      const actualizado = await tx.cobroEmpresa.update({
        where: { id: cobro.id },
        data: {
          estado: 'APLICADO',
          monto: new Decimal(monto),
          medioPago: datos.medioPago ?? cobro.medioPago ?? 'OTRO',
          referencia: datos.referencia ?? cobro.referencia,
          fechaCobro: ahora,
          cubreHasta,
          motivo: null,
        },
      });

      await tx.empresa.update({
        where: { id: cobro.empresaId },
        data: { fechaExpiracion: cubreHasta, estado: 'ACTIVO' },
      });

      // El ingreso es lo que hace que el panel de finanzas vea la plata de los
      // clientes directos; hasta ahora solo sumaba el canal reseller.
      await tx.ingresoSistema.create({
        data: {
          concepto: `Mensualidad ${cobro.periodo} — ${cobro.empresa.razonSocial}`,
          tipo: 'SUSCRIPCION',
          monto: new Decimal(monto),
          fecha: ahora,
          empresaId: cobro.empresaId,
          cobroEmpresaId: cobro.id,
          descripcion: `${cobro.planNombre ?? cobro.empresa.plan?.nombre ?? 'Plan'} · ${datos.medioPago ?? 'OTRO'}${datos.referencia ? ` · ref. ${datos.referencia}` : ''}`,
        },
      });

      return actualizado;
    });

    await this.avisarAdmins(cobro.empresaId, {
      tipo: 'INFO',
      titulo: 'Pago registrado',
      mensaje: `Recibimos tu pago de S/ ${monto.toFixed(2)}. Tu plan queda activo hasta el ${cubreHasta.toLocaleDateString('es-PE')}.`,
    });

    return resultado;
  }

  /**
   * Carga un pago de un mes ya pasado, para armar el historial hacia atrás.
   *
   * Antes de esto el historial de cada empresa arrancaba vacío: las
   * renovaciones de años anteriores se cobraron por Yape y no quedaron en
   * ningún lado. Con esto se pueden ir anotando.
   *
   * La diferencia con `registrarPago` es deliberada: un pago histórico **NO
   * mueve `fechaExpiracion`**. Ese mes ya se consumió; extender la suscripción
   * al cargarlo le regalaría a la empresa tantos meses como registros se
   * carguen.
   */
  async registrarPagoHistorico(datos: {
    empresaId: number;
    periodo: string;
    monto: number;
    fechaCobro: Date;
    medioPago?: string;
    referencia?: string;
  }) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(datos.periodo)) {
      throw new BadRequestException('El periodo debe tener el formato AAAA-MM');
    }
    if (!(Number(datos.monto) > 0)) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: datos.empresaId },
      select: { id: true, razonSocial: true, plan: { select: { nombre: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    const yaExiste = await this.prisma.cobroEmpresa.findFirst({
      where: { empresaId: datos.empresaId, periodo: datos.periodo },
      select: { id: true, estado: true },
    });
    if (yaExiste) {
      throw new BadRequestException(
        `Esa empresa ya tiene un cobro de ${datos.periodo} (${yaExiste.estado.toLowerCase()}).`,
      );
    }

    // El vencimiento del periodo: el último día del mes que se está cargando.
    const [anio, mes] = datos.periodo.split('-').map(Number);
    const fechaVencimiento = new Date(Date.UTC(anio, mes, 0, 12, 0, 0));
    const monto = Number(datos.monto);

    return this.prisma.$transaction(async (tx) => {
      const cobro = await tx.cobroEmpresa.create({
        data: {
          empresaId: datos.empresaId,
          periodo: datos.periodo,
          planNombre: empresa.plan?.nombre ?? null,
          monto: new Decimal(monto),
          estado: 'APLICADO',
          medioPago: datos.medioPago ?? 'OTRO',
          referencia: datos.referencia,
          fechaVencimiento,
          fechaCobro: datos.fechaCobro,
          descripcion: `Mensualidad ${datos.periodo} (cargada al historial)`,
        },
      });

      await tx.ingresoSistema.create({
        data: {
          concepto: `Mensualidad ${datos.periodo} — ${empresa.razonSocial}`,
          tipo: 'SUSCRIPCION',
          monto: new Decimal(monto),
          fecha: datos.fechaCobro,
          empresaId: datos.empresaId,
          cobroEmpresaId: cobro.id,
          descripcion: `Cargado al historial${datos.referencia ? ` · ref. ${datos.referencia}` : ''}`,
        },
      });

      return cobro;
    });
  }

  // ── 3. Los que no pagaron ────────────────────────────────────────────────

  /**
   * Avisa durante la gracia y suspende cuando se acaba.
   *
   * Suspender es poner la empresa en INACTIVO: el login y el guard ya rechazan
   * eso, así que no hace falta nada más. El corte real lo decide
   * `evaluarGracia`, no este cron — si el servidor no corrió el cron un día, el
   * acceso no cambia por eso.
   */
  async procesarVencidos(ahora: Date = new Date()) {
    const pendientes = await this.prisma.cobroEmpresa.findMany({
      where: {
        estado: 'PENDIENTE',
        fechaVencimiento: { lt: ahora },
      },
      include: {
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            estado: true,
            fechaExpiracion: true,
            resellerId: true,
            usaDemo: true,
          },
        },
      },
    });

    let avisados = 0;
    let suspendidas = 0;

    for (const cobro of pendientes) {
      // Si entre la emisión y hoy la empresa pasó a ser de un reseller o a demo,
      // deja de ser asunto de este ciclo.
      if (cobro.empresa.resellerId != null || cobro.empresa.usaDemo) continue;
      const gracia = evaluarGracia(cobro.empresa.fechaExpiracion, ahora);

      // Todavía no vence de verdad: o le movieron el vencimiento a mano tras
      // pagar por otro lado, o el cobro se emitió por adelantado y hoy es el
      // último día, que sigue siendo suyo. En ninguno de los dos casos hay a
      // quién suspender.
      //
      // Esta guarda tiene que mirar `gracia.vencida` y no `fechaExpiracion >
      // ahora`: la fecha se guarda a medianoche UTC, así que el mismo día de
      // vencimiento ya es "menor que ahora" y la comparación cruda suspendería
      // a una empresa que todavía tiene su día.
      if (!gracia.vencida) continue;

      if (gracia.enGracia) {
        await this.prisma.cobroEmpresa.update({
          where: { id: cobro.id },
          data: { intento: { increment: 1 }, motivo: 'EN_GRACIA' },
        });
        await this.avisarAdmins(cobro.empresaId, {
          tipo: 'WARNING',
          titulo: 'Tu plan venció',
          mensaje: `Tu mensualidad de ${cobro.periodo} (S/ ${Number(cobro.monto).toFixed(2)}) sigue pendiente. Te quedan ${gracia.diasRestantes} día(s) para regularizar antes de que se suspenda el acceso.`,
        });
        avisados += 1;
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.cobroEmpresa.update({
          where: { id: cobro.id },
          data: {
            estado: 'RECHAZADO',
            motivo: 'NO_PAGADO',
            intento: { increment: 1 },
          },
        });
        if (cobro.empresa.estado !== 'INACTIVO') {
          await tx.empresa.update({
            where: { id: cobro.empresaId },
            data: { estado: 'INACTIVO' },
          });
        }
      });
      await this.avisarAdmins(cobro.empresaId, {
        tipo: 'CRITICAL',
        titulo: 'Cuenta suspendida por falta de pago',
        mensaje: `Se suspendió el acceso por la mensualidad de ${cobro.periodo} sin pagar. Regulariza el pago para reactivarla.`,
      });
      suspendidas += 1;
    }

    return { evaluados: pendientes.length, avisados, suspendidas };
  }

  // ── Consulta ─────────────────────────────────────────────────────────────

  async listar(filtros: {
    estado?: string;
    empresaId?: number;
    periodo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filtros.page ?? 1);
    const limit = Math.min(200, Math.max(1, filtros.limit ?? 50));
    const where = {
      ...(filtros.estado ? { estado: filtros.estado } : {}),
      ...(filtros.empresaId ? { empresaId: filtros.empresaId } : {}),
      ...(filtros.periodo ? { periodo: filtros.periodo } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.cobroEmpresa.count({ where }),
      this.prisma.cobroEmpresa.findMany({
        where,
        include: {
          empresa: {
            select: {
              id: true,
              razonSocial: true,
              ruc: true,
              estado: true,
              fechaExpiracion: true,
            },
          },
        },
        orderBy: [{ fechaVencimiento: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, page, limit, items };
  }

  /** Cobrado vs pendiente del mes: el MRR real al lado del teórico. */
  async resumen(periodo?: string) {
    const mes = periodo ?? this.periodoDe(new Date());
    const [aplicado, pendiente, rechazado] = await Promise.all([
      this.prisma.cobroEmpresa.aggregate({
        where: { periodo: mes, estado: 'APLICADO' },
        _sum: { monto: true },
        _count: true,
      }),
      this.prisma.cobroEmpresa.aggregate({
        where: { periodo: mes, estado: 'PENDIENTE' },
        _sum: { monto: true },
        _count: true,
      }),
      this.prisma.cobroEmpresa.aggregate({
        where: { periodo: mes, estado: 'RECHAZADO' },
        _sum: { monto: true },
        _count: true,
      }),
    ]);
    const num = (v: unknown) => Number(v ?? 0);
    return {
      periodo: mes,
      cobrado: { monto: num(aplicado._sum.monto), empresas: aplicado._count },
      pendiente: {
        monto: num(pendiente._sum.monto),
        empresas: pendiente._count,
      },
      noPagado: {
        monto: num(rechazado._sum.monto),
        empresas: rechazado._count,
      },
    };
  }

  /**
   * Los pagos de la propia empresa, para su pantalla "Mi plan".
   *
   * Va aparte de `listar` porque ese endpoint es de ADMIN_SISTEMA y recibe un
   * `empresaId` por query: si el empresario pudiera llamarlo, vería la cartera
   * de cobros de cualquier otra empresa cambiando un número en la URL. Acá el
   * id sale del token y no se puede pedir otro.
   */
  async historialDeMiEmpresa(empresaId: number, limite = 24) {
    const cobros = await this.prisma.cobroEmpresa.findMany({
      where: { empresaId },
      orderBy: [{ fechaVencimiento: 'desc' }, { id: 'desc' }],
      take: Math.min(60, Math.max(1, limite)),
      select: {
        id: true,
        periodo: true,
        planNombre: true,
        monto: true,
        estado: true,
        medioPago: true,
        referencia: true,
        fechaVencimiento: true,
        fechaCobro: true,
        cubreHasta: true,
      },
    });
    const pagados = cobros.filter((c) => c.estado === 'APLICADO');
    return {
      cobros,
      totalPagado: pagados.reduce((s, c) => s + Number(c.monto), 0),
      mesesPagados: pagados.length,
    };
  }

  /** Lo que ve el empresario en su pantalla de suscripción. */
  async estadoDeMiSuscripcion(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        fechaExpiracion: true,
        estado: true,
        // Desde cuándo es cliente: con el historial recién arrancando, es lo
        // único cierto que se le puede mostrar de su pasado.
        fechaActivacion: true,
        plan: { select: { nombre: true, costo: true } },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    const gracia = evaluarGracia(empresa.fechaExpiracion);
    const pendiente = await this.prisma.cobroEmpresa.findFirst({
      where: { empresaId, estado: 'PENDIENTE' },
      orderBy: { fechaVencimiento: 'asc' },
    });
    return {
      plan: empresa.plan,
      fechaExpiracion: empresa.fechaExpiracion,
      clienteDesde: empresa.fechaActivacion,
      ...gracia,
      cobroPendiente: pendiente
        ? {
            id: pendiente.id,
            periodo: pendiente.periodo,
            monto: Number(pendiente.monto),
            fechaVencimiento: pendiente.fechaVencimiento,
          }
        : null,
    };
  }

  private async avisarAdmins(
    empresaId: number,
    aviso: {
      tipo: 'INFO' | 'WARNING' | 'CRITICAL';
      titulo: string;
      mensaje: string;
    },
  ) {
    try {
      const admins = await this.prisma.usuario.findMany({
        where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.notificaciones.crearNotificacion({
          usuarioId: admin.id,
          empresaId,
          ...aviso,
        });
      }
    } catch (e: any) {
      // Un aviso que no sale no puede tumbar el cobro: el dinero y el estado de
      // la cuenta ya se resolvieron antes de llegar acá.
      this.logger.warn(
        `No se pudo notificar a la empresa ${empresaId}: ${e?.message}`,
      );
    }
  }
}
