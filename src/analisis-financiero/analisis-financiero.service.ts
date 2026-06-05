import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoCompra, EstadoSunat, GastoOperativo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearGastoDto } from './dto/crear-gasto.dto';
import { ActualizarGastoDto } from './dto/actualizar-gasto.dto';

export interface GastoPorCategoria {
  categoria: string;
  etiqueta: string | null;
  monto: number;
}

export interface PnlResponse {
  periodo: { mes: number; anio: number; label: string };
  ventasNetas: number;
  costoMercaderia: number;
  gananciaBruta: number;
  margenBruto: number;
  gastosTotales: number;
  gastosPorCategoria: GastoPorCategoria[];
  gananciaNeta: number;
  margenNeto: number;
  comparacion: {
    mesAnterior: { gananciaNeta: number; margenNeto: number } | null;
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

@Injectable()
export class AnalisisFinancieroService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Returns UTC-5 (Lima) period boundaries for a given mes/anio. */
  private periodoToRange(mes: number, anio: number) {
    const gte = new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0, 0));
    const lte = new Date(Date.UTC(anio, mes, 1, 4, 59, 59, 999));
    return { gte, lte };
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

  private r2(n: number): number { return Math.round(n * 100) / 100; }

  /** Computes P&L figures from pre-fetched raw data. */
  private calcularPnl(
    comprobantes: { tipoDoc: string; estadoEnvioSunat: string; mtoImpVenta: number }[],
    compras: { total: { toNumber(): number } }[],
    gastosRaw: { categoria: string; etiqueta: string | null; monto: { toNumber(): number } }[],
  ) {
    const ventasBrutas = comprobantes
      .filter(c => c.tipoDoc !== '07' && c.estadoEnvioSunat !== EstadoSunat.ANULADO)
      .reduce((acc, c) => acc + c.mtoImpVenta, 0);

    const notasCredito = comprobantes
      .filter(c => c.tipoDoc === '07' && c.estadoEnvioSunat !== EstadoSunat.ANULADO)
      .reduce((acc, c) => acc + c.mtoImpVenta, 0);

    const ventasNetas    = ventasBrutas - notasCredito;
    const costoMercaderia = compras.reduce((acc, c) => acc + c.total.toNumber(), 0);
    const gananciaBruta  = ventasNetas - costoMercaderia;

    // Build gastosPorCategoria grouping by (categoria, etiqueta)
    const gastoMap = new Map<string, GastoPorCategoria>();
    for (const g of gastosRaw) {
      const key = `${g.categoria}::${g.etiqueta ?? ''}`;
      const existing = gastoMap.get(key);
      if (existing) {
        existing.monto = this.r2(existing.monto + g.monto.toNumber());
      } else {
        gastoMap.set(key, { categoria: g.categoria, etiqueta: g.etiqueta, monto: this.r2(g.monto.toNumber()) });
      }
    }
    const gastosPorCategoria = [...gastoMap.values()];
    const gastosTotales = gastosPorCategoria.reduce((acc, g) => acc + g.monto, 0);

    const gananciaNeta = gananciaBruta - gastosTotales;
    const margenBruto  = ventasNetas > 0 ? (gananciaBruta / ventasNetas) * 100 : 0;
    const margenNeto   = ventasNetas > 0 ? (gananciaNeta  / ventasNetas) * 100 : 0;

    return {
      ventasNetas:      this.r2(ventasNetas),
      costoMercaderia:  this.r2(costoMercaderia),
      gananciaBruta:    this.r2(gananciaBruta),
      margenBruto:      this.r2(margenBruto),
      gastosTotales:    this.r2(gastosTotales),
      gastosPorCategoria,
      gananciaNeta:     this.r2(gananciaNeta),
      margenNeto:       this.r2(margenNeto),
    };
  }

  // ─── Public methods ──────────────────────────────────────────────────────────

  /** Fetches raw data for one period and returns calculated P&L. */
  private async fetchPeriodData(empresaId: number, mes: number, anio: number) {
    const range = this.periodoToRange(mes, anio);
    const [comprobantes, compras, gastos] = await Promise.all([
      this.prisma.comprobante.findMany({
        where: { empresaId, fechaEmision: { gte: range.gte, lte: range.lte } },
        select: { tipoDoc: true, estadoEnvioSunat: true, mtoImpVenta: true },
      }),
      this.prisma.compra.findMany({
        where: { empresaId, estado: { not: EstadoCompra.ANULADO }, fechaEmision: { gte: range.gte, lte: range.lte } },
        select: { total: true },
      }),
      this.prisma.gastoOperativo.findMany({
        where: { empresaId, mes, anio },
        select: { categoria: true, etiqueta: true, monto: true },
      }),
    ]);
    return this.calcularPnl(comprobantes, compras, gastos);
  }

  /** GET /pnl — P&L for a single mes/anio period. */
  async getPnl(empresaId: number, mes: number, anio: number): Promise<PnlResponse> {
    const prev = this.restarMeses(mes, anio, 1);

    const [pnl, pnlAnterior] = await Promise.all([
      this.fetchPeriodData(empresaId, mes, anio),
      this.fetchPeriodData(empresaId, prev.mes, prev.anio),
    ]);

    const tieneAnterior = pnlAnterior.ventasNetas > 0 || pnlAnterior.gastosTotales > 0;
    const variacionMonto = tieneAnterior ? this.r2(pnl.gananciaNeta - pnlAnterior.gananciaNeta) : null;
    const variacionPorcentaje = tieneAnterior && pnlAnterior.gananciaNeta !== 0
      ? this.r2(((pnl.gananciaNeta - pnlAnterior.gananciaNeta) / Math.abs(pnlAnterior.gananciaNeta)) * 100)
      : null;

    return {
      periodo: { mes, anio, label: this.mesLabel(mes) },
      ...pnl,
      comparacion: {
        mesAnterior: tieneAnterior ? { gananciaNeta: pnlAnterior.gananciaNeta, margenNeto: pnlAnterior.margenNeto } : null,
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
    const [comprobantes, compras, gastos] = await Promise.all([
      this.prisma.comprobante.findMany({
        where: {
          empresaId,
          fechaEmision: { gte: rangeGte, lte: rangeLte },
        },
        select: {
          tipoDoc: true,
          estadoEnvioSunat: true,
          mtoImpVenta: true,
          fechaEmision: true,
        },
      }),
      this.prisma.compra.findMany({
        where: {
          empresaId,
          estado: { not: EstadoCompra.ANULADO },
          fechaEmision: { gte: rangeGte, lte: rangeLte },
        },
        select: { total: true, fechaEmision: true },
      }),
      this.prisma.gastoOperativo.findMany({
        where: {
          empresaId,
          OR: this.buildMesAnioOr(mesActual, anioActual, meses),
        },
        select: { categoria: true, etiqueta: true, monto: true, mes: true, anio: true },
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

      const comprasDelMes = compras.filter((c) => {
        const t = c.fechaEmision.getTime();
        return t >= range.gte.getTime() && t <= range.lte.getTime();
      });

      const gastosDelMes = gastos.filter(
        (g) => g.mes === mes && g.anio === anio,
      );

      const pnl = this.calcularPnl(comprobantesDelMes, comprasDelMes, gastosDelMes);

      resultado.push({
        mes,
        anio,
        label: this.mesLabel(mes),
        shortLabel: this.mesShortLabel(mes),
        ventasNetas:     pnl.ventasNetas,
        gananciaBruta:   pnl.gananciaBruta,
        gananciaNeta:    pnl.gananciaNeta,
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

  /** GET /gastos — list operative expenses for a period. */
  async listarGastos(
    empresaId: number,
    mes: number,
    anio: number,
  ): Promise<GastoOperativo[]> {
    return this.prisma.gastoOperativo.findMany({
      where: { empresaId, mes, anio },
      orderBy: { creadoEn: 'asc' },
    });
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
        ...(dto.categoria !== undefined && { categoria: dto.categoria }),
        ...(dto.etiqueta !== undefined && { etiqueta: dto.etiqueta }),
        ...(dto.monto !== undefined && { monto: dto.monto }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      },
    });
  }

  /** DELETE /gastos/:id — remove an operative expense. */
  async eliminarGasto(
    empresaId: number,
    id: number,
  ): Promise<{ id: number }> {
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
