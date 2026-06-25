import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoSunat, GastoOperativo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearGastoDto } from './dto/crear-gasto.dto';
import { ActualizarGastoDto } from './dto/actualizar-gasto.dto';

export interface GastoPorCategoria {
  categoria: string;
  etiqueta: string | null;
  monto: number;
}

export interface OtroIngreso {
  concepto: string;
  tipo: string;
  monto: number;
}

export interface PnlResponse {
  periodo: { mes: number; anio: number; label: string };
  ventasNetas: number;
  costoBaseProductos: number;
  costosFijosProducto: number;
  costoMercaderia: number;
  unidadesVendidas: number;
  lineasProducto: number;
  lineasServicio: number;
  gananciaBruta: number;
  margenBruto: number;
  otrosIngresos: number;
  otrosIngresosDetalle: OtroIngreso[];
  gastosTotales: number;
  gastoPublicidad: number;
  gastosPorCategoria: GastoPorCategoria[];
  gananciaNeta: number;
  margenNeto: number;
  resumenDiario: RentabilidadDia[];
  comparacion: {
    mesAnterior: { gananciaNeta: number; margenNeto: number; otrosIngresos: number } | null;
    variacionMonto: number | null;
    variacionPorcentaje: number | null;
  };
}

export interface EvolucionPoint {
  mes: number;
  anio: number;
  label: string;
  shortLabel: string;
  ventasNetas: number;
  gananciaBruta: number;
  gananciaNeta: number;
}

interface DecimalLike {
  toNumber(): number;
}

interface ProductoCostoPnl {
  costoPromedio: DecimalLike | number | null;
  costoFijo: DecimalLike | number | null;
}

interface DetalleComprobantePnl {
  productoId: number | null;
  cantidad: number;
  producto: ProductoCostoPnl | null;
}

interface ComprobantePnl {
  tipoDoc: string;
  estadoEnvioSunat: EstadoSunat;
  mtoImpVenta: number;
  fechaEmision?: Date;
  detalles: DetalleComprobantePnl[];
}

export interface RentabilidadDia {
  fecha: string;
  ventasNetas: number;
  costoMercaderia: number;
  gananciaBruta: number;
  margenBruto: number;
  publicidad: number;
  otrosGastos: number;
  gastosOperativos: number;
  gananciaNeta: number;
  margenNeto: number;
  pedidos: number;
  roas: number | null;
  costoPublicidadPorPedido: number | null;
}

interface GastoPnl {
  categoria: string;
  etiqueta: string | null;
  monto: DecimalLike;
  fecha: Date | null;
  recurrenteDiario: boolean;
  fechaInicio: Date | null;
  fechaFin: Date | null;
}

interface GastoAplicadoPnl {
  categoria: string;
  etiqueta: string | null;
  monto: number;
  fecha: string | null;
}

@Injectable()
export class AnalisisFinancieroService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly TIPOS_INFORMALES = ['NP', 'OT', 'COT', 'TICKET', 'NV', 'RH', 'CP'];

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
          tipoDoc: { notIn: ['NP', 'COT', 'OT'] },
        }
      ]
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Returns UTC-5 (Lima) period boundaries for a given mes/anio. */
  private periodoToRange(mes: number, anio: number) {
    const gte = new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0, 0));
    const lte = new Date(Date.UTC(anio, mes, 1, 4, 59, 59, 999));
    return { gte, lte };
  }

  private fechasToRange(fechaInicio?: string, fechaFin?: string) {
    if (!fechaInicio || !fechaFin) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin)) {
      return null;
    }
    return {
      gte: new Date(`${fechaInicio}T00:00:00.000-05:00`),
      lte: new Date(`${fechaFin}T23:59:59.999-05:00`),
    };
  }

  private readonly MESES_LARGO = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];

  private readonly MESES_CORTO = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  private mesLabel(mes: number): string {
    return this.MESES_LARGO[mes - 1] ?? String(mes);
  }

  private mesShortLabel(mes: number): string {
    return this.MESES_CORTO[mes - 1] ?? String(mes);
  }

  /** Subtracts N months from a given mes/anio pair. */
  private restarMeses(
    mes: number,
    anio: number,
    n: number,
  ): { mes: number; anio: number } {
    const date = new Date(anio, mes - 1, 1);
    date.setMonth(date.getMonth() - n);
    return { mes: date.getMonth() + 1, anio: date.getFullYear() };
  }

  private r2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private toNumber(value: DecimalLike | number | null | undefined): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value && typeof value.toNumber === 'function') return value.toNumber();
    return 0;
  }

  private fechaLimaKey(fecha?: Date): string | null {
    if (!fecha) return null;
    return new Date(fecha.getTime() - 5 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  private parseFechaGasto(fecha?: string): Date | undefined {
    if (!fecha) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return new Date(`${fecha}T05:00:00.000Z`);
    }
    const parsed = new Date(fecha);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private monthEndKey(mes: number, anio: number): string {
    const day = new Date(anio, mes, 0).getDate();
    return `${anio}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private todayLimaKey(): string {
    return (
      this.fechaLimaKey(new Date()) ?? new Date().toISOString().slice(0, 10)
    );
  }

  private listarDiasPeriodo(mes: number, anio: number): string[] {
    const startKey = `${anio}-${String(mes).padStart(2, '0')}-01`;
    let endKey = this.monthEndKey(mes, anio);
    const todayKey = this.todayLimaKey();
    if (startKey > todayKey) return [];
    if (endKey > todayKey) endKey = todayKey;

    const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
    const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
    const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    const days: string[] = [];

    while (current.getTime() <= end.getTime()) {
      days.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return days;
  }

  private expandirGastosPeriodo(
    gastosRaw: GastoPnl[],
    mes: number,
    anio: number,
  ): GastoAplicadoPnl[] {
    const diasPeriodo = this.listarDiasPeriodo(mes, anio);
    const startKey = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const endKey = this.monthEndKey(mes, anio);
    const gastosAplicados: GastoAplicadoPnl[] = [];

    for (const gasto of gastosRaw) {
      const monto = this.toNumber(gasto.monto);
      if (!gasto.recurrenteDiario) {
        gastosAplicados.push({
          categoria: gasto.categoria,
          etiqueta: gasto.etiqueta,
          monto,
          fecha: this.fechaLimaKey(gasto.fecha ?? undefined),
        });
        continue;
      }

      const fechaInicio =
        this.fechaLimaKey(gasto.fechaInicio ?? gasto.fecha ?? undefined) ??
        startKey;
      const fechaFin = this.fechaLimaKey(gasto.fechaFin ?? undefined) ?? endKey;

      for (const fecha of diasPeriodo) {
        if (fecha < fechaInicio || fecha > fechaFin) continue;
        gastosAplicados.push({
          categoria: gasto.categoria,
          etiqueta: gasto.etiqueta,
          monto,
          fecha,
        });
      }
    }

    return gastosAplicados;
  }

  private esDocumentoVenta(c: ComprobantePnl): boolean {
    return c.tipoDoc !== 'COT' && c.estadoEnvioSunat !== EstadoSunat.ANULADO;
  }

  private signoDocumento(tipoDoc: string): 1 | -1 {
    return tipoDoc === '07' ? -1 : 1;
  }

  private calcularCostoProducto(comprobante: ComprobantePnl) {
    const signo = this.signoDocumento(comprobante.tipoDoc);
    let costoBaseProductos = 0;
    let costosFijosProducto = 0;
    let unidadesVendidas = 0;
    let lineasProducto = 0;
    let lineasServicio = 0;

    for (const detalle of comprobante.detalles ?? []) {
      if (!detalle.productoId || !detalle.producto) {
        lineasServicio += 1;
        continue;
      }

      const cantidad = Number(detalle.cantidad || 0) * signo;
      const producto = detalle.producto;
      costoBaseProductos += cantidad * this.toNumber(producto.costoPromedio);
      costosFijosProducto += cantidad * this.toNumber(producto.costoFijo);
      unidadesVendidas += cantidad;
      lineasProducto += 1;
    }

    const costoMercaderia = costoBaseProductos + costosFijosProducto;

    return {
      costoBaseProductos,
      costosFijosProducto,
      costoMercaderia,
      unidadesVendidas,
      lineasProducto,
      lineasServicio,
    };
  }

  private readonly TIPOS_FINANCIAMIENTO = ['PRESTAMO', 'INVERSION', 'CAPITAL'];

  /** Computes P&L figures from pre-fetched raw data. */
  private calcularPnl(
    comprobantes: ComprobantePnl[],
    gastosRaw: GastoPnl[],
    mes: number,
    anio: number,
    otrosIngresos: number = 0,
  ) {
    const gastosAplicados = this.expandirGastosPeriodo(gastosRaw, mes, anio);
    const documentosVenta = comprobantes.filter((c) =>
      this.esDocumentoVenta(c),
    );
    const ventasBrutas = documentosVenta
      .filter((c) => c.tipoDoc !== '07')
      .reduce((acc, c) => acc + c.mtoImpVenta, 0);

    const notasCredito = documentosVenta
      .filter((c) => c.tipoDoc === '07')
      .reduce((acc, c) => acc + c.mtoImpVenta, 0);

    const costosProducto = documentosVenta.reduce(
      (acc, comprobante) => {
        const costo = this.calcularCostoProducto(comprobante);
        acc.costoBaseProductos += costo.costoBaseProductos;
        acc.costosFijosProducto += costo.costosFijosProducto;
        acc.costoMercaderia += costo.costoMercaderia;
        acc.unidadesVendidas += costo.unidadesVendidas;
        acc.lineasProducto += costo.lineasProducto;
        acc.lineasServicio += costo.lineasServicio;
        return acc;
      },
      {
        costoBaseProductos: 0,
        costosFijosProducto: 0,
        costoMercaderia: 0,
        unidadesVendidas: 0,
        lineasProducto: 0,
        lineasServicio: 0,
      },
    );

    const resumenDiarioMap = new Map<string, RentabilidadDia>();
    for (const comprobante of documentosVenta) {
      const fecha = this.fechaLimaKey(comprobante.fechaEmision);
      if (!fecha) continue;
      const signo = this.signoDocumento(comprobante.tipoDoc);
      const costo = this.calcularCostoProducto(comprobante);
      const current = resumenDiarioMap.get(fecha) ?? {
        fecha,
        ventasNetas: 0,
        costoMercaderia: 0,
        gananciaBruta: 0,
        margenBruto: 0,
        publicidad: 0,
        otrosGastos: 0,
        gastosOperativos: 0,
        gananciaNeta: 0,
        margenNeto: 0,
        pedidos: 0,
        roas: null,
        costoPublicidadPorPedido: null,
      };
      current.ventasNetas += Number(comprobante.mtoImpVenta || 0) * signo;
      current.costoMercaderia += costo.costoMercaderia;
      if (signo > 0) current.pedidos += 1;
      resumenDiarioMap.set(fecha, current);
    }

    for (const gasto of gastosAplicados) {
      const fecha = gasto.fecha;
      if (!fecha) continue;
      const monto = gasto.monto;
      const current = resumenDiarioMap.get(fecha) ?? {
        fecha,
        ventasNetas: 0,
        costoMercaderia: 0,
        gananciaBruta: 0,
        margenBruto: 0,
        publicidad: 0,
        otrosGastos: 0,
        gastosOperativos: 0,
        gananciaNeta: 0,
        margenNeto: 0,
        pedidos: 0,
        roas: null,
        costoPublicidadPorPedido: null,
      };
      if (gasto.categoria === 'PUBLICIDAD') {
        current.publicidad += monto;
      } else {
        current.otrosGastos += monto;
      }
      current.gastosOperativos += monto;
      resumenDiarioMap.set(fecha, current);
    }

    const resumenDiario = [...resumenDiarioMap.values()]
      .map((dia) => {
        const gananciaBrutaDia = dia.ventasNetas - dia.costoMercaderia;
        const gananciaNetaDia = gananciaBrutaDia - dia.gastosOperativos;
        return {
          fecha: dia.fecha,
          ventasNetas: this.r2(dia.ventasNetas),
          costoMercaderia: this.r2(dia.costoMercaderia),
          gananciaBruta: this.r2(gananciaBrutaDia),
          margenBruto: this.r2(
            dia.ventasNetas > 0
              ? (gananciaBrutaDia / dia.ventasNetas) * 100
              : 0,
          ),
          publicidad: this.r2(dia.publicidad),
          otrosGastos: this.r2(dia.otrosGastos),
          gastosOperativos: this.r2(dia.gastosOperativos),
          gananciaNeta: this.r2(gananciaNetaDia),
          margenNeto: this.r2(
            dia.ventasNetas > 0 ? (gananciaNetaDia / dia.ventasNetas) * 100 : 0,
          ),
          pedidos: dia.pedidos,
          roas:
            dia.publicidad > 0
              ? this.r2(dia.ventasNetas / dia.publicidad)
              : null,
          costoPublicidadPorPedido:
            dia.publicidad > 0 && dia.pedidos > 0
              ? this.r2(dia.publicidad / dia.pedidos)
              : null,
        };
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    const ventasNetas = ventasBrutas - notasCredito;
    const costoMercaderia = costosProducto.costoMercaderia;
    const gananciaBruta = ventasNetas - costoMercaderia;

    // Build gastosPorCategoria grouping by (categoria, etiqueta)
    const gastoMap = new Map<string, GastoPorCategoria>();
    for (const g of gastosAplicados) {
      const key = `${g.categoria}::${g.etiqueta ?? ''}`;
      const existing = gastoMap.get(key);
      if (existing) {
        existing.monto = this.r2(existing.monto + g.monto);
      } else {
        gastoMap.set(key, {
          categoria: g.categoria,
          etiqueta: g.etiqueta,
          monto: this.r2(g.monto),
        });
      }
    }
    const gastosPorCategoria = [...gastoMap.values()];
    const gastosTotales = gastosPorCategoria.reduce(
      (acc, g) => acc + g.monto,
      0,
    );
    const gastoPublicidad = gastosAplicados
      .filter((g) => g.categoria === 'PUBLICIDAD')
      .reduce((acc, g) => acc + g.monto, 0);

    const gananciaNeta = gananciaBruta + otrosIngresos - gastosTotales;
    const margenBruto =
      ventasNetas > 0 ? (gananciaBruta / ventasNetas) * 100 : 0;
    const ingresosTotales = ventasNetas + otrosIngresos;
    const margenNeto = ingresosTotales > 0 ? (gananciaNeta / ingresosTotales) * 100 : 0;

    return {
      ventasNetas: this.r2(ventasNetas),
      costoBaseProductos: this.r2(costosProducto.costoBaseProductos),
      costosFijosProducto: this.r2(costosProducto.costosFijosProducto),
      costoMercaderia: this.r2(costoMercaderia),
      unidadesVendidas: this.r2(costosProducto.unidadesVendidas),
      lineasProducto: costosProducto.lineasProducto,
      lineasServicio: costosProducto.lineasServicio,
      gananciaBruta: this.r2(gananciaBruta),
      margenBruto: this.r2(margenBruto),
      otrosIngresos: this.r2(otrosIngresos),
      gastosTotales: this.r2(gastosTotales),
      gastoPublicidad: this.r2(gastoPublicidad),
      gastosPorCategoria,
      gananciaNeta: this.r2(gananciaNeta),
      margenNeto: this.r2(margenNeto),
      resumenDiario,
    };
  }

  // ─── Public methods ──────────────────────────────────────────────────────────

  /** Fetches raw data for one period and returns calculated P&L. */
  private async fetchPeriodData(empresaId: number, mes: number, anio: number) {
    const range = this.periodoToRange(mes, anio);
    const gastoWhere = this.buildGastoPeriodoWhere(empresaId, mes, anio);
    const [comprobantes, gastos, campanas, ingresosManuales] = await Promise.all([
      this.prisma.comprobante.findMany({
        where: {
          empresaId,
          fechaEmision: { gte: range.gte, lte: range.lte },
          ...this.filtroExcluirConvertidos,
        },
        select: {
          tipoDoc: true,
          estadoEnvioSunat: true,
          mtoImpVenta: true,
          fechaEmision: true,
          detalles: {
            select: {
              productoId: true,
              cantidad: true,
              producto: {
                select: {
                  costoPromedio: true,
                  costoFijo: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.gastoOperativo.findMany({
        where: gastoWhere,
        select: {
          categoria: true,
          etiqueta: true,
          monto: true,
          fecha: true,
          recurrenteDiario: true,
          fechaInicio: true,
          fechaFin: true,
        },
      }),
      this.prisma.campanaMarketing.findMany({
        where: { empresaId },
        select: { nombre: true, plataforma: true, presupuestoDiario: true, fechaInicio: true, estado: true },
      }),
      this.prisma.ingresoManual.findMany({
        where: {
          empresaId,
          fecha: { gte: range.gte, lte: range.lte },
          tipo: { notIn: this.TIPOS_FINANCIAMIENTO },
        },
        select: { concepto: true, tipo: true, monto: true },
        orderBy: { creadoEn: 'desc' },
      }),
    ]);

    const otrosIngresos = ingresosManuales.reduce(
      (sum, i) => sum + this.toNumber(i.monto as any),
      0,
    );
    const otrosIngresosDetalle = ingresosManuales.map((i) => ({
      concepto: i.concepto,
      tipo: i.tipo,
      monto: this.r2(this.toNumber(i.monto as any)),
    }));

    // Inject active campaign spend as virtual daily PUBLICIDAD gastos
    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);
    const hoy = new Date();
    const finReal = hoy < finMes ? hoy : finMes;

    const gastosConCampanas: GastoPnl[] = [...gastos];
    for (const c of campanas) {
      if (c.estado === 'PAUSADA') continue;
      const inicio = c.fechaInicio > inicioMes ? c.fechaInicio : inicioMes;
      if (inicio > finReal) continue;
      const presupuesto = Number(c.presupuestoDiario);
      gastosConCampanas.push({
        categoria: 'PUBLICIDAD',
        etiqueta: `${c.plataforma} - ${c.nombre}`,
        monto: { toNumber: () => presupuesto },
        fecha: null,
        recurrenteDiario: true,
        fechaInicio: inicio,
        fechaFin: finReal,
      });
    }

    return {
      ...this.calcularPnl(comprobantes, gastosConCampanas, mes, anio, otrosIngresos),
      otrosIngresosDetalle,
    };
  }

  /** GET /pnl — P&L for a single mes/anio period. */
  async getPnl(
    empresaId: number,
    mes: number,
    anio: number,
  ): Promise<PnlResponse> {
    const prev = this.restarMeses(mes, anio, 1);

    const [pnl, pnlAnterior] = await Promise.all([
      this.fetchPeriodData(empresaId, mes, anio),
      this.fetchPeriodData(empresaId, prev.mes, prev.anio),
    ]);

    const tieneAnterior =
      pnlAnterior.ventasNetas > 0 || pnlAnterior.gastosTotales > 0 || pnlAnterior.otrosIngresos > 0;
    const variacionMonto = tieneAnterior
      ? this.r2(pnl.gananciaNeta - pnlAnterior.gananciaNeta)
      : null;
    const variacionPorcentaje =
      tieneAnterior && pnlAnterior.gananciaNeta !== 0
        ? this.r2(
            ((pnl.gananciaNeta - pnlAnterior.gananciaNeta) /
              Math.abs(pnlAnterior.gananciaNeta)) *
              100,
          )
        : null;

    return {
      periodo: { mes, anio, label: this.mesLabel(mes) },
      ...pnl,
      comparacion: {
        mesAnterior: tieneAnterior
          ? {
              gananciaNeta: pnlAnterior.gananciaNeta,
              margenNeto: pnlAnterior.margenNeto,
              otrosIngresos: pnlAnterior.otrosIngresos,
            }
          : null,
        variacionMonto,
        variacionPorcentaje,
      },
    };
  }

  /**
   * GET /evolucion — P&L evolution for the last N months.
   * Fetches all comprobante/compra data in ONE query per entity, then groups in JS.
   */
  async getEvolucion(
    empresaId: number,
    meses: number,
  ): Promise<EvolucionPoint[]> {
    // Determine the N-month window
    const now = new Date();
    const mesActual = now.getMonth() + 1;
    const anioActual = now.getFullYear();

    const inicio = this.restarMeses(mesActual, anioActual, meses - 1);
    const rangeGte = this.periodoToRange(inicio.mes, inicio.anio).gte;
    const rangeLte = this.periodoToRange(mesActual, anioActual).lte;

    // Single query per entity covering the full window
    const [comprobantes, gastos, todosIngresosManuales] = await Promise.all([
      this.prisma.comprobante.findMany({
        where: {
          empresaId,
          fechaEmision: { gte: rangeGte, lte: rangeLte },
          ...this.filtroExcluirConvertidos,
        },
        select: {
          tipoDoc: true,
          estadoEnvioSunat: true,
          mtoImpVenta: true,
          fechaEmision: true,
          detalles: {
            select: {
              productoId: true,
              cantidad: true,
              producto: {
                select: {
                  costoPromedio: true,
                  costoFijo: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.gastoOperativo.findMany({
        where: this.buildGastosEvolucionWhere(
          empresaId,
          rangeGte,
          rangeLte,
          mesActual,
          anioActual,
          meses,
        ),
        select: {
          categoria: true,
          etiqueta: true,
          monto: true,
          fecha: true,
          recurrenteDiario: true,
          fechaInicio: true,
          fechaFin: true,
          mes: true,
          anio: true,
        },
      }),
      this.prisma.ingresoManual.findMany({
        where: {
          empresaId,
          fecha: { gte: rangeGte, lte: rangeLte },
          tipo: { notIn: this.TIPOS_FINANCIAMIENTO },
        },
        select: { fecha: true, monto: true },
      }),
    ]);

    // Build result iterating backwards from current month
    const resultado: EvolucionPoint[] = [];

    for (let i = meses - 1; i >= 0; i--) {
      const { mes, anio } = this.restarMeses(mesActual, anioActual, i);
      const range = this.periodoToRange(mes, anio);

      const comprobantesDelMes = comprobantes.filter((c) => {
        const t = c.fechaEmision.getTime();
        return t >= range.gte.getTime() && t <= range.lte.getTime();
      });

      const gastosDelMes = gastos.filter(
        (g) =>
          (g.mes === mes && g.anio === anio) ||
          this.gastoRecurrenteCubrePeriodo(g, range.gte, range.lte),
      );

      const otrosIngresosDelMes = todosIngresosManuales
        .filter((i) => {
          const t = i.fecha.getTime();
          return t >= range.gte.getTime() && t <= range.lte.getTime();
        })
        .reduce((sum, i) => sum + this.toNumber(i.monto as any), 0);

      const pnl = this.calcularPnl(comprobantesDelMes, gastosDelMes, mes, anio, otrosIngresosDelMes);

      resultado.push({
        mes,
        anio,
        label: this.mesLabel(mes),
        shortLabel: this.mesShortLabel(mes),
        ventasNetas: pnl.ventasNetas,
        gananciaBruta: pnl.gananciaBruta,
        gananciaNeta: pnl.gananciaNeta,
      });
    }

    return resultado;
  }

  /** Builds an OR condition for gastoOperativo covering N months back from mesActual/anioActual. */
  private buildMesAnioOr(
    mesActual: number,
    anioActual: number,
    meses: number,
  ): { mes: number; anio: number }[] {
    const conditions: { mes: number; anio: number }[] = [];
    for (let i = 0; i < meses; i++) {
      conditions.push(this.restarMeses(mesActual, anioActual, i));
    }
    return conditions;
  }

  private buildGastoPeriodoWhere(empresaId: number, mes: number, anio: number) {
    const range = this.periodoToRange(mes, anio);
    return {
      empresaId,
      OR: [
        { mes, anio },
        {
          recurrenteDiario: true,
          fechaInicio: { lte: range.lte },
          OR: [{ fechaFin: null }, { fechaFin: { gte: range.gte } }],
        },
      ],
    };
  }

  private buildGastosEvolucionWhere(
    empresaId: number,
    rangeGte: Date,
    rangeLte: Date,
    mesActual: number,
    anioActual: number,
    meses: number,
  ) {
    return {
      empresaId,
      OR: [
        ...this.buildMesAnioOr(mesActual, anioActual, meses),
        {
          recurrenteDiario: true,
          fechaInicio: { lte: rangeLte },
          OR: [{ fechaFin: null }, { fechaFin: { gte: rangeGte } }],
        },
      ],
    };
  }

  private gastoRecurrenteCubrePeriodo(
    gasto: {
      recurrenteDiario: boolean;
      fechaInicio: Date | null;
      fechaFin: Date | null;
    },
    gte: Date,
    lte: Date,
  ): boolean {
    if (!gasto.recurrenteDiario || !gasto.fechaInicio) return false;
    return (
      gasto.fechaInicio <= lte && (!gasto.fechaFin || gasto.fechaFin >= gte)
    );
  }

  /** GET /gastos — list operative expenses for a period. */
  async listarGastos(
    empresaId: number,
    mes: number,
    anio: number,
  ): Promise<GastoOperativo[]> {
    const gastoWhere = this.buildGastoPeriodoWhere(empresaId, mes, anio);
    return this.prisma.gastoOperativo.findMany({
      where: gastoWhere,
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    });
  }

  /** GET /gastos/historial — list all operative expenses optionally by date range. */
  async historialGastos(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
  ): Promise<GastoOperativo[]> {
    const where: any = { empresaId };
    if (fechaInicio && fechaFin) {
      const start = new Date(`${fechaInicio}T00:00:00.000-05:00`);
      const end = new Date(`${fechaFin}T23:59:59.999-05:00`);
      where.fecha = { gte: start, lte: end };
    }
    return this.prisma.gastoOperativo.findMany({
      where,
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
      take: 500,
    });
  }

  // ─── Rentabilidad por Categorías ─────────────────────────────────────────────

  async getRentabilidadCategorias(empresaId: number, mes: number, anio: number) {
    const range = this.periodoToRange(mes, anio);

    const comprobantes = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        fechaEmision: { gte: range.gte, lte: range.lte },
        ...this.filtroExcluirConvertidos,
      },
      select: {
        tipoDoc: true,
        estadoEnvioSunat: true,
        detalles: {
          select: {
            descripcion: true,
            cantidad: true,
            mtoPrecioUnitario: true,
            productoId: true,
            producto: {
              select: {
                descripcion: true,
                costoPromedio: true,
                costoFijo: true,
                categoria: { select: { nombre: true } },
              },
            },
          },
        },
      },
    });

    // catKey → { prodKey → accumulator }
    const catMap = new Map<string, Map<string, {
      nombre: string;
      ingreso: number;
      costo: number;
      unidades: number;
    }>>();

    for (const comp of comprobantes) {
      if (comp.estadoEnvioSunat === 'ANULADO' || comp.tipoDoc === 'COT') continue;
      const signo: 1 | -1 = comp.tipoDoc === '07' ? -1 : 1;

      for (const det of comp.detalles) {
        const catNombre = det.producto?.categoria?.nombre ?? 'Sin categoría';
        const prodNombre = det.producto?.descripcion ?? det.descripcion ?? 'Producto';
        const prodKey = String(det.productoId ?? prodNombre);
        const qty = (det.cantidad ?? 0) * signo;
        const precioUnit = det.mtoPrecioUnitario ?? 0;
        const costoUnit = this.toNumber(det.producto?.costoPromedio) + this.toNumber(det.producto?.costoFijo);

        if (!catMap.has(catNombre)) catMap.set(catNombre, new Map());
        const prodMap = catMap.get(catNombre)!;

        if (!prodMap.has(prodKey)) {
          prodMap.set(prodKey, { nombre: prodNombre, ingreso: 0, costo: 0, unidades: 0 });
        }
        const acc = prodMap.get(prodKey)!;
        acc.ingreso += precioUnit * qty;
        acc.costo += costoUnit * qty;
        acc.unidades += qty;
      }
    }

    const categorias = [...catMap.entries()].map(([catNombre, prodMap]) => {
      const productos = [...prodMap.values()]
        .map((p) => {
          const gananciaTotal = this.r2(p.ingreso - p.costo);
          const margen = p.ingreso > 0 ? this.r2(((p.ingreso - p.costo) / p.ingreso) * 100) : 0;
          return {
            nombre: p.nombre,
            precioUnitario: this.r2(p.unidades !== 0 ? p.ingreso / p.unidades : 0),
            costoUnitario: this.r2(p.unidades !== 0 ? p.costo / p.unidades : 0),
            margen,
            unidadesVendidas: this.r2(p.unidades),
            ingresoTotal: this.r2(p.ingreso),
            gananciaTotal,
          };
        })
        .sort((a, b) => b.gananciaTotal - a.gananciaTotal);

      const ingresoTotal = this.r2(productos.reduce((s, p) => s + p.ingresoTotal, 0));
      const gananciaTotal = this.r2(productos.reduce((s, p) => s + p.gananciaTotal, 0));
      const unidadesVendidas = this.r2(productos.reduce((s, p) => s + p.unidadesVendidas, 0));
      const margenPromedio = ingresoTotal > 0 ? this.r2((gananciaTotal / ingresoTotal) * 100) : 0;

      return {
        nombre: catNombre,
        ingresoTotal,
        gananciaTotal,
        margenPromedio,
        unidadesVendidas,
        cantidadProductos: productos.length,
        productos,
      };
    }).sort((a, b) => b.gananciaTotal - a.gananciaTotal);

    const ingresoTotal = this.r2(categorias.reduce((s, c) => s + c.ingresoTotal, 0));
    const gananciaTotal = this.r2(categorias.reduce((s, c) => s + c.gananciaTotal, 0));
    const margenPromedio = ingresoTotal > 0 ? this.r2((gananciaTotal / ingresoTotal) * 100) : 0;

    return {
      periodo: { mes, anio, label: `${this.mesLabel(mes)} ${anio}` },
      ingresoTotal,
      gananciaTotal,
      margenPromedio,
      totalCategorias: categorias.length,
      mejorCategoria: categorias[0]?.nombre ?? null,
      categorias,
    };
  }

  async getMetodosPago(
    empresaId: number,
    mes?: number,
    anio?: number,
    fechaInicio?: string,
    fechaFin?: string,
  ) {
    const now = new Date();
    const mesFinal = mes && mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1;
    const anioFinal = anio && anio >= 2020 && anio <= 2100 ? anio : now.getFullYear();
    const range = this.fechasToRange(fechaInicio, fechaFin) ?? this.periodoToRange(mesFinal, anioFinal);
    const periodoLabel = fechaInicio && fechaFin
      ? `${fechaInicio} al ${fechaFin}`
      : `${this.mesLabel(mesFinal)} ${anioFinal}`;

    const pagos = await this.prisma.pago.findMany({
      where: {
        empresaId,
        fecha: { gte: range.gte, lte: range.lte },
        comprobante: {
          estadoEnvioSunat: { not: EstadoSunat.ANULADO },
          ...this.filtroExcluirConvertidos,
        },
      },
      orderBy: { fecha: 'desc' },
      select: {
        id: true,
        fecha: true,
        monto: true,
        medioPago: true,
        referencia: true,
        observacion: true,
        cuentaBancaria: {
          select: { banco: true, alias: true, numeroCuenta: true, cci: true },
        },
        comprobante: {
          select: {
            id: true,
            tipoDoc: true,
            serie: true,
            correlativo: true,
            estadoPago: true,
            mtoImpVenta: true,
            cliente: { select: { nombre: true, nroDoc: true } },
          },
        },
      },
    });

    const comprobantesRespaldo = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        fechaEmision: { gte: range.gte, lte: range.lte },
        estadoEnvioSunat: { not: EstadoSunat.ANULADO },
        estadoPago: 'COMPLETADO',
        formaPagoTipo: { in: ['Contado', 'CONTADO', 'contado'] },
        pagos: { none: {} },
        ...this.filtroExcluirConvertidos,
      },
      orderBy: { fechaEmision: 'desc' },
      select: {
        id: true,
        fechaEmision: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        medioPago: true,
        mtoImpVenta: true,
        estadoPago: true,
        paymentDetails: true,
        cliente: { select: { nombre: true, nroDoc: true } },
      },
    });

    const metodoMap = new Map<string, {
      metodo: string;
      total: number;
      cantidad: number;
      referencias: number;
      cuentas: Set<string>;
      items: any[];
    }>();

    const cuentaLabel = (cuenta?: { banco?: string | null; alias?: string | null; numeroCuenta?: string | null } | null) => {
      if (!cuenta) return null;
      return `${cuenta.alias || cuenta.banco || 'Cuenta'} ${String(cuenta.numeroCuenta || '').slice(-4)}`.trim();
    };

    const addItem = (item: any) => {
      const metodo = String(item.metodo || 'EFECTIVO').toUpperCase();
      const current = metodoMap.get(metodo) || {
        metodo,
        total: 0,
        cantidad: 0,
        referencias: 0,
        cuentas: new Set<string>(),
        items: [],
      };
      current.total += Number(item.monto || 0);
      current.cantidad += 1;
      if (item.referencia) current.referencias += 1;
      if (item.cuenta) current.cuentas.add(item.cuenta);
      current.items.push(item);
      metodoMap.set(metodo, current);
    };

    for (const pago of pagos) {
      addItem({
        id: `P-${pago.id}`,
        origen: 'PAGO',
        fecha: this.fechaLimaKey(pago.fecha),
        metodo: pago.medioPago,
        monto: this.r2(Number(pago.monto || 0)),
        referencia: pago.referencia || null,
        cuenta: cuentaLabel(pago.cuentaBancaria),
        observacion: pago.observacion || null,
        documento: `${pago.comprobante.tipoDoc} ${pago.comprobante.serie}-${String(pago.comprobante.correlativo).padStart(8, '0')}`,
        comprobanteId: pago.comprobante.id,
        cliente: pago.comprobante.cliente?.nombre || 'CLIENTES VARIOS',
        clienteDoc: pago.comprobante.cliente?.nroDoc || null,
        estadoPago: pago.comprobante.estadoPago,
      });
    }

    for (const comp of comprobantesRespaldo) {
      const details: any = comp.paymentDetails || {};
      const split = Array.isArray(details?.splitPayments) ? details.splitPayments : null;
      const legacyLines = split && split.length > 0
        ? split.map((line: any) => ({
            metodo: line.method || comp.medioPago || 'EFECTIVO',
            monto: Number(line.amount || 0),
            referencia: line.referencia || null,
            cuenta: line.cuentaBancariaLabel || null,
          }))
        : [{
            metodo: comp.medioPago || details?.method || 'EFECTIVO',
            monto: Number(comp.mtoImpVenta || 0),
            referencia: details?.referencia || null,
            cuenta: details?.cuentaBancariaLabel || null,
          }];

      for (const line of legacyLines) {
        addItem({
          id: `C-${comp.id}-${line.metodo}`,
          origen: 'COMPROBANTE_SIN_PAGO',
          fecha: this.fechaLimaKey(comp.fechaEmision),
          metodo: line.metodo,
          monto: this.r2(Number(line.monto || 0)),
          referencia: line.referencia,
          cuenta: line.cuenta,
          observacion: 'Respaldo por comprobante antiguo sin pago separado',
          documento: `${comp.tipoDoc} ${comp.serie}-${String(comp.correlativo).padStart(8, '0')}`,
          comprobanteId: comp.id,
          cliente: comp.cliente?.nombre || 'CLIENTES VARIOS',
          clienteDoc: comp.cliente?.nroDoc || null,
          estadoPago: comp.estadoPago,
        });
      }
    }

    const metodos = [...metodoMap.values()]
      .map((metodo) => ({
        metodo: metodo.metodo,
        total: this.r2(metodo.total),
        cantidad: metodo.cantidad,
        referencias: metodo.referencias,
        cuentas: [...metodo.cuentas],
        items: metodo.items.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
      }))
      .sort((a, b) => b.total - a.total);

    const totalCobrado = this.r2(metodos.reduce((sum, metodo) => sum + metodo.total, 0));
    const totalReferenciado = metodos.reduce((sum, metodo) => sum + metodo.referencias, 0);
    const totalItems = metodos.reduce((sum, metodo) => sum + metodo.cantidad, 0);

    return {
      periodo: {
        mes: mesFinal,
        anio: anioFinal,
        fechaInicio: fechaInicio || null,
        fechaFin: fechaFin || null,
        label: periodoLabel,
      },
      resumen: {
        totalCobrado,
        totalMetodos: metodos.length,
        totalPagos: totalItems,
        totalConReferencia: totalReferenciado,
        totalRespaldo: comprobantesRespaldo.length,
      },
      metodos,
    };
  }

  /** POST /gastos — create a new operative expense. */
  async crearGasto(
    empresaId: number,
    dto: CrearGastoDto,
  ): Promise<GastoOperativo> {
    return this.prisma.gastoOperativo.create({
      data: {
        empresaId,
        mes: dto.mes,
        anio: dto.anio,
        fecha: this.parseFechaGasto(dto.fecha),
        recurrenteDiario: dto.recurrenteDiario ?? false,
        fechaInicio: dto.recurrenteDiario
          ? this.parseFechaGasto(dto.fechaInicio ?? dto.fecha)
          : null,
        fechaFin: dto.recurrenteDiario
          ? this.parseFechaGasto(dto.fechaFin)
          : null,
        categoria: dto.categoria,
        etiqueta: dto.etiqueta,
        monto: dto.monto,
        descripcion: dto.descripcion,
      },
    });
  }

  /** PATCH /gastos/:id — update an operative expense (mes/anio are NOT patchable). */
  async actualizarGasto(
    empresaId: number,
    id: number,
    dto: ActualizarGastoDto,
  ): Promise<GastoOperativo> {
    const existing = await this.prisma.gastoOperativo.findFirst({
      where: { id, empresaId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Gasto con id ${id} no encontrado para esta empresa`,
      );
    }

    return this.prisma.gastoOperativo.update({
      where: { id },
      data: {
        ...(dto.fecha !== undefined && {
          fecha: this.parseFechaGasto(dto.fecha) ?? null,
        }),
        ...(dto.recurrenteDiario !== undefined && {
          recurrenteDiario: dto.recurrenteDiario,
        }),
        ...(dto.recurrenteDiario === false && {
          fechaInicio: null,
          fechaFin: null,
        }),
        ...(dto.fechaInicio !== undefined &&
          dto.recurrenteDiario !== false && {
            fechaInicio: this.parseFechaGasto(dto.fechaInicio) ?? null,
          }),
        ...(dto.fechaFin !== undefined &&
          dto.recurrenteDiario !== false && {
            fechaFin: this.parseFechaGasto(dto.fechaFin) ?? null,
          }),
        ...(dto.categoria !== undefined && { categoria: dto.categoria }),
        ...(dto.etiqueta !== undefined && { etiqueta: dto.etiqueta }),
        ...(dto.monto !== undefined && { monto: dto.monto }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      },
    });
  }

  /** DELETE /gastos/:id — remove an operative expense. */
  async eliminarGasto(empresaId: number, id: number): Promise<{ id: number }> {
    const existing = await this.prisma.gastoOperativo.findFirst({
      where: { id, empresaId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Gasto con id ${id} no encontrado para esta empresa`,
      );
    }

    await this.prisma.gastoOperativo.delete({ where: { id } });
    return { id };
  }
}
