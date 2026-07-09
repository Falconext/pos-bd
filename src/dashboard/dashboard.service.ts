import { BadRequestException, Injectable } from '@nestjs/common';
import { EstadoSunat, EstadoPago } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // Tipos de comprobantes informales (no van a SUNAT)
  private readonly TIPOS_INFORMALES = [
    'NP',
    'OT',
    'COT',
    'TICKET',
    'NV',
    'RH',
    'CP',
  ];

  /**
   * Filtro para excluir comprobantes informales que ya fueron convertidos
   * a un formal (tienen al menos un comprobante derivado).
   * Se agrega en el WHERE como AND condition.
   */
  private get filtroExcluirConvertidos() {
    return {
      AND: [
        {
          NOT: {
            tipoDoc: { in: this.TIPOS_INFORMALES },
            comprobantesDerivados: { some: {} },
          },
        },
        {
          // Excluir documentos de pre-venta que no son ventas cerradas
          tipoDoc: { notIn: ['NP', 'COT', 'OT'] },
        },
      ],
    };
  }

  private parseRange(fechaInicio?: string, fechaFin?: string) {
    const whereFecha: any = {};
    if (fechaInicio)
      whereFecha.gte = new Date(`${fechaInicio}T00:00:00.000-05:00`);
    if (fechaFin) whereFecha.lte = new Date(`${fechaFin}T23:59:59.999-05:00`);
    return Object.keys(whereFecha).length ? whereFecha : undefined;
  }

  // Lima es siempre UTC-5 (sin DST). Extrae "YYYY-MM-DD" en hora Lima.
  private toFechaLima(d: Date): string {
    return new Date(d.getTime() - 5 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  async headerResumen(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number,
  ) {
    const startTime = Date.now();
    try {
      const fechaEmision = this.parseRange(fechaInicio, fechaFin);
      const whereBase: any = {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        ...(fechaEmision ? { fechaEmision } : {}),
        estadoEnvioSunat: { not: 'ANULADO' as any },
        ...this.filtroExcluirConvertidos,
      };

      const guiaWhere: any = {
        empresaId,
        ...(fechaEmision ? { fechaEmision } : {}),
      };

      const [
        totalIngresosPositivo,
        totalIngresosNC,
        totalComprobantes,
        totalGuias,
        totalClientes,
        totalProductos,
        ingresosManuales,
      ] = await Promise.all([
        // Suma facturas/boletas/informales (positivos)
        this.prisma.comprobante.aggregate({
          _sum: { mtoImpVenta: true },
          where: { ...whereBase, tipoDoc: { notIn: ['07'] } },
        }),
        // Suma notas de crédito (se restan)
        this.prisma.comprobante.aggregate({
          _sum: { mtoImpVenta: true },
          where: { ...whereBase, tipoDoc: '07' },
        }),
        this.prisma.comprobante.count({ where: whereBase }),
        this.prisma.guiaRemision.count({ where: guiaWhere }),
        this.prisma.cliente.count({ where: { empresaId } }),
        // Excluir productos fantasma (DGD, IPM, PLD) y productos inactivos del conteo
        this.prisma.producto.count({
          where: {
            empresaId,
            estado: 'ACTIVO',
            codigo: { notIn: ['DGD', 'IPM', 'PLD'] },
          },
        }),
        sedeId
          ? Promise.resolve([] as any[])
          : this.prisma.ingresoManual.findMany({
              where: {
                empresaId,
                ...(fechaEmision ? { fecha: fechaEmision } : {}),
              },
            }),
      ]);

      const elapsed = Date.now() - startTime;
      console.log(
        `[Dashboard] headerResumen completed in ${elapsed}ms for empresa ${empresaId}`,
      );

      const TIPOS_FINANCIAMIENTO = ['PRESTAMO', 'INVERSION', 'CAPITAL'];
      const otrosIngresos = ingresosManuales.reduce(
        (sum: number, i: any) =>
          sum + (TIPOS_FINANCIAMIENTO.includes(i.tipo) ? 0 : Number(i.monto)),
        0,
      );

      return {
        totalIngresos:
          Number(totalIngresosPositivo._sum.mtoImpVenta ?? 0) -
          Number(totalIngresosNC._sum.mtoImpVenta ?? 0) +
          otrosIngresos,
        totalComprobantes: totalComprobantes + totalGuias,
        totalClientes,
        totalProductos,
      };
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      console.error(
        `[Dashboard] headerResumen FAILED after ${elapsed}ms for empresa ${empresaId}:`,
        error.message,
      );
      throw error;
    }
  }

  async ingresosPorComprobante(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    const rows = await this.prisma.comprobante.groupBy({
      by: ['fechaEmision', 'tipoDoc'],
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        ...(fechaEmision ? { fechaEmision } : {}),
        estadoEnvioSunat: { not: 'ANULADO' as any },
        ...this.filtroExcluirConvertidos,
      },
      _sum: { mtoImpVenta: true },
    });
    const TIPOS_INFORMALES = new Set(this.TIPOS_INFORMALES);

    const map = new Map<
      string,
      {
        fecha: string;
        facturas: number;
        boletas: number;
        notasCredito: number;
        notasDebito: number;
        informales: number;
      }
    >();
    for (const r of rows) {
      const fecha = this.toFechaLima(r.fechaEmision);
      const item = map.get(fecha) || {
        fecha,
        facturas: 0,
        boletas: 0,
        notasCredito: 0,
        notasDebito: 0,
        informales: 0,
      };
      const total = Number(r._sum.mtoImpVenta ?? 0);
      if (r.tipoDoc === '01') item.facturas += total;
      else if (r.tipoDoc === '03') item.boletas += total;
      else if (r.tipoDoc === '07') item.notasCredito += total;
      else if (r.tipoDoc === '08') item.notasDebito += total;
      else if (TIPOS_INFORMALES.has(r.tipoDoc)) item.informales += total;
      map.set(fecha, item);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    );
  }

  async ingresosPorMedioPago(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    const rows = await this.prisma.comprobante.groupBy({
      by: ['fechaEmision', 'medioPago'],
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        ...(fechaEmision ? { fechaEmision } : {}),
        estadoEnvioSunat: { not: 'ANULADO' as any },
        ...this.filtroExcluirConvertidos,
      },
      _sum: { mtoImpVenta: true },
    });
    const map = new Map<
      string,
      { fecha: string; YAPE: number; PLIN: number; EFECTIVO: number }
    >();
    for (const r of rows) {
      const fecha = this.toFechaLima(r.fechaEmision);
      const item = map.get(fecha) || { fecha, YAPE: 0, PLIN: 0, EFECTIVO: 0 };
      const total = Number(r._sum.mtoImpVenta ?? 0);
      const medio = (r.medioPago || '').toString().toUpperCase();
      if (medio === 'YAPE') item.YAPE += total;
      else if (medio === 'PLIN') item.PLIN += total;
      else if (medio === 'EFECTIVO') item.EFECTIVO += total;
      map.set(fecha, item);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    );
  }

  async topProductos(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    limit = 10,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    // Prefiltrar comprobantes (IDs) filtrar tambien por sede
    const comprobantes = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        ...(fechaEmision ? { fechaEmision } : {}),
        estadoEnvioSunat: { not: 'ANULADO' as any },
        ...this.filtroExcluirConvertidos,
      },
      select: { id: true },
    });
    const compIds = comprobantes.map((c) => c.id);
    if (compIds.length === 0) return [];
    const detalles = await this.prisma.detalleComprobante.groupBy({
      by: ['productoId'],
      where: { comprobanteId: { in: compIds } },
      _sum: { cantidad: true, mtoValorVenta: true },
      orderBy: { _sum: { mtoValorVenta: 'desc' } },
      take: limit,
    });
    if (detalles.length === 0) return [];
    const productos = await this.prisma.producto.findMany({
      where: {
        id: {
          in: detalles
            .map((d) => d.productoId)
            .filter((id): id is number => id !== null),
        },
      },
      select: { id: true, descripcion: true, codigo: true, stock: true },
    });
    const mapProd = new Map(productos.map((p) => [p.id, p] as const));
    return detalles.map((d) => {
      const prod = d.productoId ? mapProd.get(d.productoId) || null : null;
      const stock = prod ? (prod as any).stock : 0;
      return {
        productoId: d.productoId,
        producto: prod,
        stock,
        cantidad: Number(d._sum.cantidad ?? 0),
        total: Number(d._sum.mtoValorVenta ?? 0),
      };
    });
  }

  async overview(
    empresaId: number,
    fechaInicio: string,
    fechaFin: string,
    sedeId?: number,
  ) {
    const currentRange = this.parseRange(fechaInicio, fechaFin);
    if (!currentRange) {
      throw new BadRequestException(
        'fechaInicio y fechaFin son requeridos para overview',
      );
    }

    const start = new Date(`${fechaInicio}T00:00:00.000-05:00`);
    const end = new Date(`${fechaFin}T23:59:59.999-05:00`);
    const diffMs = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - diffMs - 24 * 60 * 60 * 1000);
    const prevEnd = new Date(end.getTime() - diffMs - 24 * 60 * 60 * 1000);

    const prevRange = {
      gte: new Date(prevStart.setHours(0, 0, 0, 0)),
      lte: new Date(prevEnd.setHours(23, 59, 59, 999)),
    };

    const baseComprobanteWhere = {
      empresaId,
      ...(sedeId ? { sedeId } : {}),
      estadoEnvioSunat: { not: 'ANULADO' as any },
      ...this.filtroExcluirConvertidos,
    };

    const baseCompraWhere = {
      empresaId,
      ...(sedeId ? { sedeId } : {}),
    };

    const TIPOS_FINANCIAMIENTO = ['PRESTAMO', 'INVERSION', 'CAPITAL'];

    const [
      ventasCurr,
      ventasPrev,
      ventasNCCurr,
      ventasNCPrev,
      ingresosManualesCurr,
      ingresosManualesPrev,
    ] = await Promise.all([
      this.prisma.comprobante.aggregate({
        _sum: { mtoImpVenta: true },
        where: {
          ...baseComprobanteWhere,
          fechaEmision: currentRange,
          tipoDoc: { notIn: ['07'] },
        },
      }),
      this.prisma.comprobante.aggregate({
        _sum: { mtoImpVenta: true },
        where: {
          ...baseComprobanteWhere,
          fechaEmision: prevRange,
          tipoDoc: { notIn: ['07'] },
        },
      }),
      this.prisma.comprobante.aggregate({
        _sum: { mtoImpVenta: true },
        where: {
          ...baseComprobanteWhere,
          fechaEmision: currentRange,
          tipoDoc: '07',
        },
      }),
      this.prisma.comprobante.aggregate({
        _sum: { mtoImpVenta: true },
        where: {
          ...baseComprobanteWhere,
          fechaEmision: prevRange,
          tipoDoc: '07',
        },
      }),
      sedeId
        ? Promise.resolve([] as any[])
        : this.prisma.ingresoManual.findMany({
            where: { empresaId, fecha: currentRange },
          }),
      sedeId
        ? Promise.resolve([] as any[])
        : this.prisma.ingresoManual.findMany({
            where: { empresaId, fecha: prevRange },
          }),
    ]);

    const otrosIngresosCurr = ingresosManualesCurr.reduce(
      (sum: number, i: any) =>
        sum + (TIPOS_FINANCIAMIENTO.includes(i.tipo) ? 0 : Number(i.monto)),
      0,
    );
    const otrosIngresosPrev = ingresosManualesPrev.reduce(
      (sum: number, i: any) =>
        sum + (TIPOS_FINANCIAMIENTO.includes(i.tipo) ? 0 : Number(i.monto)),
      0,
    );

    const ingresosCurr =
      Number(ventasCurr._sum?.mtoImpVenta ?? 0) -
      Number(ventasNCCurr._sum?.mtoImpVenta ?? 0) +
      otrosIngresosCurr;
    const ingresosPrev =
      Number(ventasPrev._sum?.mtoImpVenta ?? 0) -
      Number(ventasNCPrev._sum?.mtoImpVenta ?? 0) +
      otrosIngresosPrev;
    const ventasTrend =
      ingresosPrev === 0
        ? 100
        : ((ingresosCurr - ingresosPrev) / ingresosPrev) * 100;

    const [pedidosCurr, pedidosPrev] = await Promise.all([
      this.prisma.comprobante.count({
        where: {
          ...baseComprobanteWhere,
          fechaEmision: currentRange,
          tipoDoc: { notIn: ['07'] },
        },
      }),
      this.prisma.comprobante.count({
        where: {
          ...baseComprobanteWhere,
          fechaEmision: prevRange,
          tipoDoc: { notIn: ['07'] },
        },
      }),
    ]);
    const pedidosTrend =
      pedidosPrev === 0
        ? 100
        : ((pedidosCurr - pedidosPrev) / pedidosPrev) * 100;

    const clientesNuevosCurrRows = await this.clientesNuevos(
      empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
    const clientesNuevosCurr = clientesNuevosCurrRows.reduce(
      (acc: number, curr: any) => acc + curr.nuevos,
      0,
    );

    const prevStartStr = prevRange.gte.toISOString().slice(0, 10);
    const prevEndStr = prevRange.lte.toISOString().slice(0, 10);
    let clientesNuevosPrev = 0;
    try {
      const clientesNuevosPrevRows = await this.clientesNuevos(
        empresaId,
        prevStartStr,
        prevEndStr,
        sedeId,
      );
      clientesNuevosPrev = clientesNuevosPrevRows.reduce(
        (acc: number, curr: any) => acc + curr.nuevos,
        0,
      );
    } catch (e) {
      clientesNuevosPrev = 0;
    }
    const clientesTrend =
      clientesNuevosPrev === 0
        ? 100
        : ((clientesNuevosCurr - clientesNuevosPrev) / clientesNuevosPrev) *
          100;

    const conversionCurr = pedidosCurr === 0 ? 0 : ingresosCurr / pedidosCurr;
    const conversionTrend =
      pedidosPrev === 0
        ? 100
        : ((ingresosCurr / pedidosCurr - ingresosPrev / pedidosPrev) /
            (ingresosPrev / pedidosPrev)) *
          100;

    const dailyVentasRows = await this.prisma.comprobante.groupBy({
      by: ['fechaEmision'],
      where: {
        ...baseComprobanteWhere,
        fechaEmision: currentRange,
        tipoDoc: { notIn: ['07'] },
      },
      _sum: { mtoImpVenta: true },
    });

    const mapDaily = new Map<string, number>();
    for (const r of dailyVentasRows) {
      const f = this.toFechaLima(r.fechaEmision);
      mapDaily.set(
        f,
        (mapDaily.get(f) || 0) + Number(r._sum?.mtoImpVenta ?? 0),
      );
    }
    const chartVentas = Array.from(mapDaily.entries())
      .map(([date, total]) => ({ date, total: Math.max(0, total) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const ventasCanalRows = await this.prisma.comprobante.groupBy({
      by: ['medioPago'],
      where: { ...baseComprobanteWhere, fechaEmision: currentRange },
      _sum: { mtoImpVenta: true },
    });

    let sumTarjeta = 0;
    let sumTransferencia = 0;
    let sumRedes = 0;
    let sumEfectivo = 0;
    let sumOtros = 0;
    for (const r of ventasCanalRows) {
      const m = (r.medioPago || '').toString().toUpperCase();
      const t = Number(r._sum?.mtoImpVenta ?? 0);
      if (m === 'TARJETA') sumTarjeta += t;
      else if (m === 'TRANSFERENCIA') sumTransferencia += t;
      else if (m === 'YAPE' || m === 'PLIN') sumRedes += t;
      else if (m === 'EFECTIVO') sumEfectivo += t;
      else sumOtros += t;
    }
    const totalCanales =
      sumTarjeta + sumTransferencia + sumRedes + sumEfectivo + sumOtros;
    const chartCanales =
      totalCanales === 0
        ? []
        : [
            {
              name: 'Tarjeta',
              value: sumTarjeta,
              percentage: (sumTarjeta / totalCanales) * 100,
            },
            {
              name: 'Transferencia',
              value: sumTransferencia,
              percentage: (sumTransferencia / totalCanales) * 100,
            },
            {
              name: 'Yape / Plin',
              value: sumRedes,
              percentage: (sumRedes / totalCanales) * 100,
            },
            {
              name: 'Efectivo',
              value: sumEfectivo,
              percentage: (sumEfectivo / totalCanales) * 100,
            },
            {
              name: 'Otros',
              value: sumOtros,
              percentage: (sumOtros / totalCanales) * 100,
            },
          ].filter((x) => x.value > 0);

    const recientes = await this.prisma.comprobante.findMany({
      where: baseComprobanteWhere,
      orderBy: { fechaEmision: 'desc' },
      take: 4,
      include: { cliente: { select: { nombre: true } } },
    });
    const actividad = recientes.map((r: any) => ({
      id: r.id,
      tipo: r.tipoDoc === '07' ? 'Reembolso procesado' : 'Nueva venta',
      descripcion: `#${r.serie}-${r.correlativo}`,
      fecha: r.fechaEmision,
      monto: r.tipoDoc === '07' ? -r.mtoImpVenta : r.mtoImpVenta,
      cliente: r.cliente?.nombre || 'CLIENTES VARIOS',
    }));

    const topProds = await this.topProductos(
      empresaId,
      fechaInicio,
      fechaFin,
      4,
      sedeId,
    );

    const comprasRows = await this.prisma.compra.aggregate({
      _sum: { total: true },
      where: { ...baseCompraWhere, fechaEmision: currentRange },
    });
    const comprasPrevRows = await this.prisma.compra.aggregate({
      _sum: { total: true },
      where: { ...baseCompraWhere, fechaEmision: prevRange },
    });

    const TIPOS_INFORMALES_ARRAY = this.TIPOS_INFORMALES;
    const [
      productosBajoStockRaw,
      sunatPendientesRows,
      sunatPendientesCount,
      cuentasCobrarAgg,
      pedidosTiendaCount,
    ] = await Promise.all([
      this.prisma.producto.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          stockMinimo: { gt: 0 },
          codigo: { notIn: ['DGD', 'IPM', 'PLD'] },
        },
        select: { id: true, descripcion: true, stock: true, stockMinimo: true },
        orderBy: { stock: 'asc' },
        take: 20,
      }),
      this.prisma.comprobante.findMany({
        where: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          estadoEnvioSunat: {
            in: [
              EstadoSunat.PENDIENTE,
              EstadoSunat.FALLIDO_ENVIO,
              EstadoSunat.RECHAZADO,
            ],
          },
          tipoDoc: { notIn: TIPOS_INFORMALES_ARRAY },
        },
        select: {
          id: true,
          serie: true,
          correlativo: true,
          tipoDoc: true,
          estadoEnvioSunat: true,
          mtoImpVenta: true,
        },
        orderBy: { fechaEmision: 'desc' },
        take: 4,
      }),
      this.prisma.comprobante.count({
        where: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          estadoEnvioSunat: {
            in: [
              EstadoSunat.PENDIENTE,
              EstadoSunat.FALLIDO_ENVIO,
              EstadoSunat.RECHAZADO,
            ],
          },
          tipoDoc: { notIn: TIPOS_INFORMALES_ARRAY },
        },
      }),
      this.prisma.comprobante.aggregate({
        // Suma el saldo pendiente (no el total), igual que Cuentas por Cobrar.
        _sum: { saldo: true },
        _count: { id: true },
        where: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          estadoPago: {
            in: [EstadoPago.PENDIENTE_PAGO, EstadoPago.PAGO_PARCIAL],
          },
          // Incluye notas de venta y demás receivables; excluye pedidos
          // preliminares (NP), cotizaciones (COT) y notas de crédito (07).
          tipoDoc: { notIn: ['NP', 'COT', '07'] },
          estadoEnvioSunat: { not: EstadoSunat.ANULADO },
          saldo: { gt: 0 },
        },
      }),
      this.prisma.pedidoTienda.count({
        where: {
          empresaId,
          estado: 'PENDIENTE' as any,
          estadoEntrega: {
            notIn: [
              'ENTREGADO_COMPLETADO',
              'CANCELADO_INTERNO',
              'CANCELADO_CLIENTE',
            ] as any,
          },
        },
      }),
    ]);

    const stockBajoList = productosBajoStockRaw
      .filter((p) => Number(p.stock) <= (p.stockMinimo ?? 0))
      .slice(0, 4);

    const comprasCurr = Number(comprasRows._sum.total ?? 0);
    const comprasPrev = Number(comprasPrevRows._sum.total ?? 0);

    // -- Gastos Operativos --
    const [gastosOpCurrRows, gastosOpPrevRows] = await Promise.all([
      this.prisma.gastoOperativo.findMany({
        where: {
          empresaId,
          OR: [
            { fecha: currentRange },
            {
              recurrenteDiario: true,
              fechaInicio: { lte: currentRange.lte },
              OR: [{ fechaFin: null }, { fechaFin: { gte: currentRange.gte } }],
            },
          ],
        },
      }),
      this.prisma.gastoOperativo.findMany({
        where: {
          empresaId,
          OR: [
            { fecha: prevRange },
            {
              recurrenteDiario: true,
              fechaInicio: { lte: prevRange.lte },
              OR: [{ fechaFin: null }, { fechaFin: { gte: prevRange.gte } }],
            },
          ],
        },
      }),
    ]);

    const calculateGastoOp = (rows: any[], gte: Date, lte: Date) => {
      let total = 0;
      const limitStart = gte.getTime();
      const limitEnd = lte.getTime();
      for (const g of rows) {
        if (!g.recurrenteDiario) {
          total += Number(g.monto);
        } else {
          const start =
            g.fechaInicio.getTime() > limitStart
              ? g.fechaInicio.getTime()
              : limitStart;
          const fin =
            g.fechaFin && g.fechaFin.getTime() < limitEnd
              ? g.fechaFin.getTime()
              : limitEnd;
          if (start <= fin) {
            const dias = Math.max(0, Math.ceil((fin - start) / 86400000));
            total += Number(g.monto) * dias;
          }
        }
      }
      return total;
    };

    const gastoOpCurr = calculateGastoOp(
      gastosOpCurrRows,
      currentRange.gte,
      currentRange.lte,
    );
    const gastoOpPrev = calculateGastoOp(
      gastosOpPrevRows,
      prevRange.gte,
      prevRange.lte,
    );

    // -- Campañas Marketing --
    const campanas = await this.prisma.campanaMarketing.findMany({
      where: { empresaId },
    });

    const calculateMarketing = (campanas: any[], gte: Date, lte: Date) => {
      let total = 0;
      const limitStart = gte.getTime();
      const limitEnd = lte.getTime();
      for (const c of campanas) {
        if (c.estado === 'PAUSADA') continue;
        const inicio =
          c.fechaInicio.getTime() > limitStart
            ? c.fechaInicio.getTime()
            : limitStart;
        let limiteCampana = limitEnd;
        if (c.fechaFin && !c.esRecurrente) {
          limiteCampana =
            c.fechaFin.getTime() < limitEnd ? c.fechaFin.getTime() : limitEnd;
        }
        if (inicio <= limiteCampana) {
          const dias = Math.max(
            0,
            Math.ceil((limiteCampana - inicio) / 86400000),
          );
          total += Number(c.presupuestoDiario) * dias;
        }
      }
      return total;
    };

    const marketingCurr = calculateMarketing(
      campanas,
      currentRange.gte,
      currentRange.lte,
    );
    const marketingPrev = calculateMarketing(
      campanas,
      prevRange.gte,
      prevRange.lte,
    );

    const gastosCurr = comprasCurr + gastoOpCurr + marketingCurr;
    const gastosPrev = comprasPrev + gastoOpPrev + marketingPrev;
    const gananciasCurr = ingresosCurr - gastosCurr;
    const gananciasPrev = ingresosPrev - gastosPrev;

    const gastosTrend =
      gastosPrev === 0 ? 100 : ((gastosCurr - gastosPrev) / gastosPrev) * 100;
    const gananciasTrend =
      gananciasPrev === 0
        ? 100
        : ((gananciasCurr - gananciasPrev) / gananciasPrev) * 100;
    const marginCurr =
      ingresosCurr > 0 ? (gananciasCurr / ingresosCurr) * 100 : 0;

    return {
      kpis: {
        ventas: { value: ingresosCurr, trend: ventasTrend },
        pedidos: { value: pedidosCurr, trend: pedidosTrend },
        clientes: { value: clientesNuevosCurr, trend: clientesTrend },
        conversion: { value: conversionCurr, trend: conversionTrend },
      },
      chartVentas,
      chartCanales,
      actividad,
      topProductos: topProds,
      financiero: {
        ingresos: { value: ingresosCurr, trend: ventasTrend },
        gastos: { value: gastosCurr, trend: gastosTrend },
        ganancias: { value: gananciasCurr, trend: gananciasTrend },
        margen: marginCurr,
      },
      alertas: {
        stockBajo: stockBajoList.map((p) => ({
          id: p.id,
          descripcion: p.descripcion,
          stock: p.stock,
          stockMinimo: p.stockMinimo,
        })),
        sunatPendientes: {
          count: sunatPendientesCount,
          items: sunatPendientesRows.map((c) => ({
            id: c.id,
            serie: c.serie,
            correlativo: c.correlativo,
            tipoDoc: c.tipoDoc,
            estado: c.estadoEnvioSunat,
            monto: Number(c.mtoImpVenta),
          })),
        },
        cuentasCobrar: {
          cantidad: cuentasCobrarAgg._count.id,
          total: Number(cuentasCobrarAgg._sum.saldo ?? 0),
        },
        pedidosTiendaPendientes: pedidosTiendaCount,
      },
    };
  }

  async clientesNuevos(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    if (!fechaEmision)
      throw new BadRequestException(
        'Se requiere rango de fechas para clientes nuevos',
      );
    // Clientes nuevos = primer comprobante de ese cliente en la empresa
    // Filtrar por sede si corresponde
    const rows = await this.prisma.comprobante.groupBy({
      by: ['clienteId'],
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        estadoEnvioSunat: { not: 'ANULADO' },
      },
      _min: { fechaEmision: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const f = r._min.fechaEmision;
      if (!f) continue;
      if (f >= fechaEmision.gte && f <= fechaEmision.lte) {
        const day = f.toISOString().slice(0, 10);
        counts.set(day, (counts.get(day) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([fecha, nuevos]) => ({ fecha, nuevos }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
}
