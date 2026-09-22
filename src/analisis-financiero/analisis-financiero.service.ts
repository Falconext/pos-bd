import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoSunat, GastoOperativo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { montoEnPen } from '../common/utils/moneda.util';
import { excluirNotasCreditoDeAnulacion } from '../common/utils/notas-credito.util';
import { coordenadasDeDestino } from './peru-coordenadas';
import { CrearGastoDto } from './dto/crear-gasto.dto';
import { ActualizarGastoDto } from './dto/actualizar-gasto.dto';
import {
  egresosCajaWhere,
  normalizarEgresoCaja,
  mapCategoriaCaja,
  EGRESO_CAJA_SELECT,
} from '../common/utils/egresos-caja.util';

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

/**
 * Criterio del IGV en las ventas del Análisis Financiero (Empresa.criterioIgvVentas):
 *  - ELECTRONICOS: se descuenta solo el IGV de facturas/boletas/NC/ND; notas de
 *    venta y tickets cuentan íntegros (ese IGV no se declara).
 *  - TODOS: se descuenta el IGV de todos los documentos (valor venta = total ÷ 1.18).
 *  - NINGUNO: no se descuenta IGV (ventas brutas, lo cobrado).
 */
export type CriterioIgvVentas = 'ELECTRONICOS' | 'TODOS' | 'NINGUNO';
const TIPOS_DOC_ELECTRONICOS = new Set(['01', '03', '07', '08']);
export const CRITERIO_IGV_LABEL: Record<CriterioIgvVentas, string> = {
  ELECTRONICOS: 'IGV descontado solo en facturas, boletas y notas de crédito/débito',
  TODOS: 'IGV descontado en todos los documentos (incluidas notas de venta)',
  NINGUNO: 'Sin descontar IGV (ventas brutas)',
};

export interface PnlResponse {
  /** Criterio del IGV aplicado (configuración de la empresa). */
  criterioIgv: CriterioIgvVentas;
  criterioIgvLabel: string;
  periodo: {
    mes: number;
    anio: number;
    label: string;
    tipo: 'mes' | 'dia' | 'rango';
    fechaInicio: string;
    fechaFin: string;
  };
  /**
   * Ventas del período SIN IGV (valor de venta) de TODOS los documentos:
   * Factura, Boleta, NC, ND y también Nota de Venta/Ticket, porque el POS
   * desglosa el IGV en todos por igual y el empresario entiende "valor venta"
   * como total ÷ 1.18 (Chocolatería: 1,034.90 → 877.03). Si se comparara la
   * venta con IGV contra el costo (que se guarda neto) el margen saldría
   * inflado ~18 puntos; y descontar solo en los electrónicos daba una cifra
   * híbrida que nadie reconocía.
   */
  ventasNetas: number;
  /** Ventas totales cobradas (con IGV), antes de descontar `igvVentas`. */
  ventasConIgv: number;
  /** IGV incluido en las ventas del período (ventas − NC). */
  igvVentas: number;
  costoBaseProductos: number;
  costosFijosProducto: number;
  costoMercaderia: number;
  unidadesVendidas: number;
  lineasProducto: number;
  lineasServicio: number;
  /**
   * Productos vendidos en el período cuya ficha tiene costo 0 (nunca se les
   * registró compra o costo). Sus líneas entran al P&L con costo cero y
   * inflan la ganancia; se informan para que el usuario los corrija.
   */
  productosSinCosto: ProductoSinCosto[];
  gananciaBruta: number;
  margenBruto: number;
  otrosIngresos: number;
  otrosIngresosDetalle: OtroIngreso[];
  gastosTotales: number;
  gastoPublicidad: number;
  gastosPorCategoria: GastoPorCategoria[];
  /**
   * Gastos marcados como "de toda la empresa" (sin sede) que NO están sumados
   * en `gastosTotales` porque se está viendo una sede concreta. En la vista
   * consolidada siempre es 0, porque ahí ya van incluidos.
   */
  gastosEmpresa: number;
  /**
   * Compras de consumo propio (Compra.esGasto: gasolina, útiles, comida,
   * servicios…) del período, NETAS de IGV. Ya están sumadas en
   * `gastosTotales` (categoría COMPRAS) y restan en `gananciaNeta`; se exponen
   * aparte para mostrarlas como su propia línea del P&L.
   */
  comprasConsumo: number;
  /** IGV de esas compras: crédito fiscal, no gasto. Informativo. */
  comprasConsumoIgv: number;
  comprasConsumoCantidad: number;
  /**
   * IGV del mes frente a SUNAT (independiente del criterio del P&L):
   * lo cobrado en facturas/boletas/NC/ND menos el crédito fiscal de TODAS las
   * compras con factura del período (inventario o consumo). Responde "¿cuánto
   * IGV pago este mes y cuánto me ahorré pidiendo facturas?".
   */
  igvSunat: {
    /** IGV de facturas, boletas y NC/ND emitidas (lo que se declara). */
    cobrado: number;
    /** IGV de compras con factura (crédito fiscal). */
    creditoCompras: number;
    comprasConFactura: number;
    /** max(0, cobrado − crédito): lo que toca pagar. */
    aPagar: number;
    /** max(0, crédito − cobrado): queda a favor para el siguiente período. */
    saldoAFavor: number;
    /** min(cobrado, crédito): lo que se dejó de pagar gracias a las facturas. */
    ahorro: number;
  };
  gananciaNeta: number;
  margenNeto: number;
  resumenDiario: RentabilidadDia[];
  comparacion: {
    mesAnterior: {
      gananciaNeta: number;
      margenNeto: number;
      otrosIngresos: number;
    } | null;
    variacionMonto: number | null;
    variacionPorcentaje: number | null;
  };
}

export interface ProductoSinCosto {
  productoId: number;
  nombre: string;
  unidades: number;
  ingreso: number;
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
  descripcion?: string | null;
}

interface DetalleComprobantePnl {
  productoId: number | null;
  cantidad: number;
  /** Precio unitario con IGV, para reportar el ingreso de productos sin costo. */
  mtoPrecioUnitario?: number | null;
  // Paquete vendido como UNA línea (Empresa.paquetesComoUnaLinea): unidades
  // reales por paquete. Sin esto, el costo/unidades de una línea de paquete
  // (cantidad=1 al precio completo) sale prorrateado por 1 unidad en vez de
  // las unidades reales vendidas.
  unidadesPorPaquete?: number | null;
  producto: ProductoCostoPnl | null;
}

interface ComprobantePnl {
  tipoDoc: string;
  estadoEnvioSunat: EstadoSunat;
  numDocAfectado?: string | null;
  mtoImpVenta: number;
  mtoIGV?: number | null;
  tipoMoneda?: string | null;
  tipoCambio?: number | null;
  fechaEmision?: Date;
  detalles: DetalleComprobantePnl[];
}

/**
 * Período que analiza el P&L. Nació mensual (mes/anio) y ahora también puede
 * ser un día o un rango de fechas, para que el usuario cuadre el sistema con
 * su arqueo diario. `mes`/`anio` son los del inicio del período: los gastos
 * operativos "no recurrentes" viejos se guardan solo con mes/anio.
 */
interface PeriodoPnl {
  tipo: 'mes' | 'dia' | 'rango';
  mes: number;
  anio: number;
  /** YYYY-MM-DD en hora Lima (inclusive). */
  startKey: string;
  endKey: string;
  gte: Date;
  lte: Date;
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

export interface ProductoVendido {
  productoId: number | null;
  codigo: string | null;
  nombre: string;
  categoria: string;
  unidadesVendidas: number;
  precioPromedio: number;
  costoUnitario: number;
  ingresoTotal: number;
  /** Ventas con IGV del producto. */
  ventasConIgv: number;
  costoTotal: number;
  gananciaTotal: number;
  margen: number;
  participacion: number;
}

export interface ProductosVendidosDia {
  fecha: string;
  unidades: number;
  ingreso: number;
  costo: number;
  ganancia: number;
  /** Ingreso del día por cada producto del top (clave = nombre del producto). */
  productos: Record<string, number>;
}

export interface ProductosVendidosResponse {
  periodo: {
    mes: number;
    anio: number;
    fechaInicio: string | null;
    fechaFin: string | null;
    label: string;
  };
  resumen: {
    /** Ventas netas sin IGV (es lo que se compara contra el costo). */
    ingresoTotal: number;
    /** Ventas con IGV, tal como las pagó el cliente (cuadra con Ventas/Comprobantes). */
    ventasConIgv: number;
    costoTotal: number;
    gananciaTotal: number;
    margenPromedio: number;
    unidadesVendidas: number;
    totalProductos: number;
    documentos: number;
    mejorProducto: string | null;
  };
  productos: ProductoVendido[];
  /** Nombres de los 5 productos con mayor ingreso, para superponer en el gráfico. */
  topProductos: string[];
  serieDiaria: ProductosVendidosDia[];
}

export interface ClienteRanking {
  clienteId: number | null;
  nombre: string;
  nroDoc: string | null;
  ciudad: string;
  compras: number;
  ingreso: number;
  ticketPromedio: number;
  primeraCompra: string | null;
  ultimaCompra: string | null;
  /** Meses distintos (YYYY-MM) con al menos una compra en el período. */
  mesesActivos: number;
  diasDesdeUltima: number | null;
}

export interface CiudadRanking {
  ciudad: string;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  compras: number;
  clientes: number;
  ingreso: number;
  /** % del ingreso total del período. */
  participacion: number;
}

export interface RepartidorRanking {
  repartidorId: number | null;
  nombre: string;
  tipo: string | null;
  envios: number;
  entregados: number;
  devueltos: number;
  tasaEntrega: number;
  costoEnvio: number;
  ingreso: number;
}

export interface CourierRanking {
  courier: string;
  envios: number;
  entregados: number;
  enTransito: number;
  devueltos: number;
  tasaEntrega: number;
  costoEnvio: number;
}

export interface AnalisisClientesResponse {
  periodo: ProductosVendidosResponse['periodo'];
  resumen: {
    ingresoTotal: number;
    documentos: number;
    clientesDistintos: number;
    clientesRecurrentes: number;
    ticketPromedio: number;
    ciudadesDistintas: number;
    envios: number;
    enviosEntregados: number;
  };
  ciudades: CiudadRanking[];
  clientes: ClienteRanking[];
  /** Cliente más fiel del período: el que más veces compró (desempata por meses activos y recencia). */
  clienteMasFiel: ClienteRanking | null;
  repartidores: RepartidorRanking[];
  couriers: CourierRanking[];
}

export interface CourierResumen {
  courier: string;
  envios: number;
  entregados: number;
  enCurso: number;
  devueltos: number;
  tasaEntrega: number;
  costoEnvio: number;
  costoPromedio: number;
  ingreso: number;
  /** Horas promedio desde el registro hasta la entrega (solo entregados con fechas). */
  horasPromedioEntrega: number | null;
  /** Monto contra entrega (COD) pendiente/gestionado por el courier. */
  montoCOD: number;
  /** Envíos en curso por etapa del courier (registrado, transito, destino…). */
  etapas: Record<string, number>;
}

export interface EnvioCourierItem {
  envioId: number;
  comprobanteId: number;
  documento: string;
  fecha: string;
  cliente: string;
  telefono: string | null;
  courier: string;
  transportista: string | null;
  nroOrden: string | null;
  claveOrden: string | null;
  destino: string;
  departamento: string | null;
  estado: string;
  etapa: string | null;
  etapaLabel: string;
  entregado: boolean;
  devuelto: boolean;
  fechaEstimada: string | null;
  diasEnCamino: number;
  retrasado: boolean;
  costoEnvio: number;
  montoCOD: number | null;
  total: number;
  repartidor: string | null;
  ultimaActualizacion: string | null;
}

export interface AnalisisCouriersResponse {
  periodo: ProductosVendidosResponse['periodo'];
  resumen: {
    envios: number;
    entregados: number;
    enCurso: number;
    devueltos: number;
    retrasados: number;
    tasaEntrega: number;
    costoEnvioTotal: number;
    ingresoMovido: number;
    horasPromedioEntrega: number | null;
    montoCOD: number;
  };
  couriers: CourierResumen[];
  serieDiaria: Array<{ fecha: string; [courier: string]: number | string }>;
  destinos: Array<{
    destino: string;
    departamento: string | null;
    provincia: string | null;
    distrito: string | null;
    envios: number;
    entregados: number;
    costoEnvio: number;
    courierPrincipal: string;
    /** Coordenadas aproximadas (tabla estática); null si el navegador debe geocodificar. */
    lat: number | null;
    lng: number | null;
  }>;
  enCurso: EnvioCourierItem[];
  recientes: EnvioCourierItem[];
}

interface GastoPnl {
  categoria: string;
  etiqueta: string | null;
  monto: DecimalLike;
  moneda?: string | null;
  tipoCambio?: DecimalLike | null;
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

  private readonly TIPOS_INFORMALES = [
    'NP',
    'OT',
    'COT',
    'TICKET',
    'NV',
    'RH',
    'CP',
  ];

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
          // Excluir SOLO cotizaciones (COT) y órdenes de trabajo (OT): no son
          // ventas en ningún rubro. La Nota de Pedido (NP) SÍ cuenta como venta
          // (es el comprobante de venta real de muchos negocios informales); si
          // se convierte en boleta/factura, la cláusula 1 la excluye por
          // comprobantesDerivados y no hay doble conteo.
          tipoDoc: { notIn: ['COT', 'OT'] },
        },
      ],
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
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin)
    ) {
      return null;
    }
    return {
      gte: new Date(`${fechaInicio}T00:00:00.000-05:00`),
      lte: new Date(`${fechaFin}T23:59:59.999-05:00`),
    };
  }

  private periodoMes(mes: number, anio: number): PeriodoPnl {
    const { gte, lte } = this.periodoToRange(mes, anio);
    return {
      tipo: 'mes',
      mes,
      anio,
      startKey: `${anio}-${String(mes).padStart(2, '0')}-01`,
      endKey: this.monthEndKey(mes, anio),
      gte,
      lte,
    };
  }

  /** Día (inicio = fin) o rango de fechas YYYY-MM-DD. `null` si no es válido. */
  private periodoRango(
    fechaInicio?: string,
    fechaFin?: string,
  ): PeriodoPnl | null {
    const range = this.fechasToRange(fechaInicio, fechaFin);
    if (!range || !fechaInicio || !fechaFin || fechaInicio > fechaFin) {
      return null;
    }
    const [anio, mes] = fechaInicio.split('-').map(Number);
    return {
      tipo: fechaInicio === fechaFin ? 'dia' : 'rango',
      mes,
      anio,
      startKey: fechaInicio,
      endKey: fechaFin,
      gte: range.gte,
      lte: range.lte,
    };
  }

  /**
   * Período inmediatamente anterior, para la comparación: el mes previo, el
   * día previo, o un rango de la misma cantidad de días pegado al inicio.
   */
  private periodoAnterior(periodo: PeriodoPnl): PeriodoPnl {
    if (periodo.tipo === 'mes') {
      const prev = this.restarMeses(periodo.mes, periodo.anio, 1);
      return this.periodoMes(prev.mes, prev.anio);
    }
    const dias = this.diasEntre(periodo.startKey, periodo.endKey);
    const endKey = this.sumarDias(periodo.startKey, -1);
    const startKey = this.sumarDias(endKey, -(dias - 1));
    return this.periodoRango(startKey, endKey) ?? periodo;
  }

  private labelPeriodo(periodo: PeriodoPnl): string {
    const ddmmyyyy = (k: string) => k.split('-').reverse().join('/');
    if (periodo.tipo === 'mes') return this.mesLabel(periodo.mes);
    if (periodo.tipo === 'dia') return ddmmyyyy(periodo.startKey);
    return `${ddmmyyyy(periodo.startKey)} al ${ddmmyyyy(periodo.endKey)}`;
  }

  /** Suma días a una clave YYYY-MM-DD (en UTC para no correr el día). */
  private sumarDias(key: string, n: number): string {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  /** Cantidad de días entre dos claves YYYY-MM-DD, ambas inclusive. */
  private diasEntre(startKey: string, endKey: string): number {
    const [y1, m1, d1] = startKey.split('-').map(Number);
    const [y2, m2, d2] = endKey.split('-').map(Number);
    const a = Date.UTC(y1, m1 - 1, d1);
    const b = Date.UTC(y2, m2 - 1, d2);
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
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
    return this.listarDiasRango(
      `${anio}-${String(mes).padStart(2, '0')}-01`,
      this.monthEndKey(mes, anio),
    );
  }

  /** Días YYYY-MM-DD del rango (inclusive), sin pasar de hoy. */
  private listarDiasRango(startKey: string, endKeyIn: string): string[] {
    let endKey = endKeyIn;
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
    periodo: PeriodoPnl,
  ): GastoAplicadoPnl[] {
    const { startKey, endKey } = periodo;
    const diasPeriodo = this.listarDiasRango(startKey, endKey);
    const gastosAplicados: GastoAplicadoPnl[] = [];

    for (const gasto of gastosRaw) {
      // Los gastos en USD se convierten a soles con su tipo de cambio para que
      // todos los KPIs de rentabilidad queden en una sola moneda (PEN).
      const montoBase = this.toNumber(gasto.monto);
      const tc = gasto.tipoCambio != null ? this.toNumber(gasto.tipoCambio) : 0;
      const monto =
        gasto.moneda === 'USD' && tc > 0 ? montoBase * tc : montoBase;
      if (!gasto.recurrenteDiario) {
        const fechaKey = this.fechaLimaKey(gasto.fecha ?? undefined);
        // En un día/rango solo entran los gastos fechados dentro del período.
        // En el mes se mantiene el criterio histórico (vienen por mes/anio,
        // aunque el gasto no tenga fecha).
        if (
          periodo.tipo !== 'mes' &&
          (!fechaKey || fechaKey < startKey || fechaKey > endKey)
        ) {
          continue;
        }
        gastosAplicados.push({
          categoria: gasto.categoria,
          etiqueta: gasto.etiqueta,
          monto,
          fecha: fechaKey,
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

  /**
   * Compras marcadas como consumo propio (Compra.esGasto) del rango, convertidas
   * a gastos del P&L: entran NETAS (subtotal sin IGV, en soles) el día de su
   * emisión, agrupadas por proveedor bajo la categoría COMPRAS. El IGV se
   * devuelve aparte porque es crédito fiscal, no un gasto.
   */
  private async comprasConsumoComoGastos(
    empresaId: number,
    gte: Date,
    lte: Date,
    sedeId?: number | null,
  ): Promise<{ gastos: GastoPnl[]; neto: number; igv: number; cantidad: number }> {
    const compras = await this.prisma.compra.findMany({
      where: {
        empresaId,
        esGasto: true,
        estado: { notIn: ['ANULADO', 'PENDIENTE_APROBACION'] as any },
        fechaEmision: { gte, lte },
        ...(sedeId ? { sedeId } : {}),
      },
      select: {
        subtotal: true,
        igv: true,
        moneda: true,
        tipoCambio: true,
        fechaEmision: true,
        proveedor: { select: { nombre: true } },
      },
    });
    let neto = 0;
    let igv = 0;
    const gastos: GastoPnl[] = compras.map((c) => {
      const tc =
        String(c.moneda || 'PEN').toUpperCase() === 'USD'
          ? this.toNumber(c.tipoCambio as any) || 1
          : 1;
      const subtotalPen = this.toNumber(c.subtotal as any) * tc;
      neto += subtotalPen;
      igv += this.toNumber(c.igv as any) * tc;
      return {
        categoria: 'COMPRAS',
        etiqueta: c.proveedor?.nombre?.trim() || 'Proveedor',
        monto: { toNumber: () => subtotalPen },
        moneda: 'PEN',
        tipoCambio: null,
        fecha: c.fechaEmision,
        recurrenteDiario: false,
        fechaInicio: null,
        fechaFin: null,
      };
    });
    return { gastos, neto, igv, cantidad: compras.length };
  }

  /** IGV (en soles) de todas las compras con FACTURA del rango: crédito fiscal. */
  private async creditoFiscalCompras(
    empresaId: number,
    gte: Date,
    lte: Date,
    sedeId?: number | null,
  ): Promise<{ igv: number; cantidad: number }> {
    const compras = await this.prisma.compra.findMany({
      where: {
        empresaId,
        tipoDoc: 'FACTURA',
        estado: { notIn: ['ANULADO', 'PENDIENTE_APROBACION'] as any },
        fechaEmision: { gte, lte },
        ...(sedeId ? { sedeId } : {}),
      },
      select: { igv: true, moneda: true, tipoCambio: true },
    });
    let igv = 0;
    for (const c of compras) {
      const tc =
        String(c.moneda || 'PEN').toUpperCase() === 'USD'
          ? this.toNumber(c.tipoCambio as any) || 1
          : 1;
      igv += this.toNumber(c.igv as any) * tc;
    }
    return { igv, cantidad: compras.length };
  }

  private esDocumentoVenta(c: ComprobantePnl): boolean {
    return c.tipoDoc !== 'COT' && c.estadoEnvioSunat !== EstadoSunat.ANULADO;
  }

  /**
   * Quita las notas de crédito "de anulación": las que afectan a un
   * comprobante que ya está ANULADO. Ese comprobante ya no suma en ninguna
   * cifra (todos los cálculos descartan ANULADO), así que restar además su NC
   * descontaba la misma venta dos veces (ventas netas, costo, unidades y la
   * serie diaria salían más bajas que lo realmente vendido). Solo se conservan
   * las NC que corrigen un documento vigente (devolución parcial, descuento
   * posterior, etc.), que sí restan de verdad.
   */
  private async excluirNotasCreditoDeAnulacion<
    T extends { tipoDoc: string; numDocAfectado?: string | null },
  >(empresaId: number, comprobantes: T[]): Promise<T[]> {
    return excluirNotasCreditoDeAnulacion(this.prisma, empresaId, comprobantes);
  }

  /** Criterio del IGV configurado por la empresa (default ELECTRONICOS). */
  private async criterioIgvEmpresa(
    empresaId: number,
  ): Promise<CriterioIgvVentas> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { criterioIgvVentas: true },
    });
    const v = String(e?.criterioIgvVentas ?? '').toUpperCase();
    return v === 'TODOS' || v === 'NINGUNO' ? v : 'ELECTRONICOS';
  }

  /** ¿Se descuenta IGV a este tipo de documento con el criterio dado? */
  private descuentaIgv(tipoDoc: string, criterio: CriterioIgvVentas): boolean {
    if (criterio === 'NINGUNO') return false;
    if (criterio === 'TODOS') return true;
    return TIPOS_DOC_ELECTRONICOS.has(String(tipoDoc));
  }

  private signoDocumento(tipoDoc: string): 1 | -1 {
    return tipoDoc === '07' ? -1 : 1;
  }

  /**
   * IGV incluido en el comprobante. Se descuenta en TODOS los tipos de
   * documento (incluidas Notas de Venta/Tickets, donde el POS también lo
   * desglosa): el "valor venta" que espera el empresario es total ÷ 1.18.
   * Solo se omite cuando el documento no trae IGV o el dato es inconsistente.
   */
  private igvDeclarado(
    c: {
      tipoDoc: string;
      mtoImpVenta: number;
      mtoIGV?: number | null;
    },
    criterio: CriterioIgvVentas,
  ): number {
    if (!this.descuentaIgv(c.tipoDoc, criterio)) return 0;
    const total = this.toNumber(c.mtoImpVenta);
    const igv = this.toNumber(c.mtoIGV);
    // Datos inconsistentes (IGV negativo o mayor al total): no descontar nada
    // antes que producir una venta neta absurda.
    if (!(igv > 0) || igv > total) return 0;
    return igv;
  }

  /** Precio × cantidad de la línea (con IGV), sin signo: lo que pagó el cliente. */
  private ventaLineaConIgv(det: {
    cantidad: number | null;
    mtoPrecioUnitario: number | null;
  }): number {
    return (det.mtoPrecioUnitario ?? 0) * (det.cantidad ?? 0);
  }

  /**
   * Ingreso de UNA línea sin IGV (ver `igvDeclarado`): usa el valor de venta
   * de la línea (base sin IGV) en cualquier tipo de documento; en líneas
   * gratuitas o sin valor guardado (donde mtoPrecioUnitario ya es el valor
   * referencial) queda precio × cantidad. Devuelve el monto en la moneda del
   * comprobante, sin signo.
   */
  private ingresoLineaSinIgv(
    tipoDoc: string,
    det: {
      cantidad: number | null;
      mtoPrecioUnitario: number | null;
      mtoValorVenta?: number | null;
      tipAfeIgv?: number | null;
    },
    criterio: CriterioIgvVentas,
  ): number {
    const bruto = (det.mtoPrecioUnitario ?? 0) * (det.cantidad ?? 0);
    if (!this.descuentaIgv(tipoDoc, criterio)) return bruto;
    const afe = Number(det.tipAfeIgv ?? 10);
    const onerosa = afe === 10 || afe === 20 || afe === 30 || afe === 40;
    const neto = this.toNumber(det.mtoValorVenta);
    if (!onerosa || !(neto > 0) || neto > bruto + 0.01) return bruto;
    return neto;
  }

  /** Total del comprobante en soles, con IGV. */
  private ventaConIgvPen(c: ComprobantePnl): number {
    return montoEnPen(c.mtoImpVenta, c.tipoMoneda, this.toNumber(c.tipoCambio));
  }

  /** IGV declarado del comprobante en soles. */
  private igvPen(c: ComprobantePnl, criterio: CriterioIgvVentas): number {
    return montoEnPen(
      this.igvDeclarado(c, criterio),
      c.tipoMoneda,
      this.toNumber(c.tipoCambio),
    );
  }

  private calcularCostoProducto(
    comprobante: ComprobantePnl,
    sinCosto?: Map<number, ProductoSinCosto>,
  ) {
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

      // Paquete vendido como UNA línea (Empresa.paquetesComoUnaLinea): la
      // cantidad facturada (p.ej. 1 caja) no son las unidades reales que
      // costaron/salieron de almacén — eso es cantidad × unidadesPorPaquete.
      const uPaquete = Number(detalle.unidadesPorPaquete) || 1;
      const cantidadFacturada = Number(detalle.cantidad || 0) * signo;
      const cantidad = cantidadFacturada * uPaquete;
      const producto = detalle.producto;
      const costoPromedio = this.toNumber(producto.costoPromedio);
      const costoFijo = this.toNumber(producto.costoFijo);
      costoBaseProductos += cantidad * costoPromedio;
      costosFijosProducto += cantidad * costoFijo;
      unidadesVendidas += cantidad;
      lineasProducto += 1;

      // Producto sin costo en su ficha: la línea entra con costo 0 y la
      // ganancia sale inflada. Se acumula para avisarle al usuario.
      if (sinCosto && costoPromedio + costoFijo <= 0 && cantidad > 0) {
        const acc = sinCosto.get(detalle.productoId) ?? {
          productoId: detalle.productoId,
          nombre: producto.descripcion ?? `Producto ${detalle.productoId}`,
          unidades: 0,
          ingreso: 0,
        };
        acc.unidades += cantidad;
        acc.ingreso += montoEnPen(
          this.toNumber(detalle.mtoPrecioUnitario) * cantidadFacturada,
          comprobante.tipoMoneda,
          this.toNumber(comprobante.tipoCambio),
        );
        sinCosto.set(detalle.productoId, acc);
      }
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
    periodo: PeriodoPnl,
    otrosIngresos: number = 0,
    criterio: CriterioIgvVentas = 'ELECTRONICOS',
  ) {
    const gastosAplicados = this.expandirGastosPeriodo(gastosRaw, periodo);
    const documentosVenta = comprobantes.filter((c) =>
      this.esDocumentoVenta(c),
    );
    // Ventas con IGV e IGV declarado, ambos netos de notas de crédito. Las
    // ventas netas del P&L son la diferencia (ver `PnlResponse.ventasNetas`).
    let ventasConIgv = 0;
    let igvVentas = 0;
    // IGV realmente declarado ante SUNAT (solo electrónicos), sea cual sea el
    // criterio con el que el P&L descuenta el IGV de las ventas.
    let igvSunatCobrado = 0;
    for (const c of documentosVenta) {
      const signo = this.signoDocumento(c.tipoDoc);
      ventasConIgv += this.ventaConIgvPen(c) * signo;
      igvVentas += this.igvPen(c, criterio) * signo;
      igvSunatCobrado += this.igvPen(c, 'ELECTRONICOS') * signo;
    }

    const productosSinCostoMap = new Map<number, ProductoSinCosto>();
    const costosProducto = documentosVenta.reduce(
      (acc, comprobante) => {
        const costo = this.calcularCostoProducto(
          comprobante,
          productosSinCostoMap,
        );
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
      current.ventasNetas +=
        (this.ventaConIgvPen(comprobante) - this.igvPen(comprobante, criterio)) *
        signo;
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

    const ventasNetas = ventasConIgv - igvVentas;
    const costoMercaderia = costosProducto.costoMercaderia;
    const gananciaBruta = ventasNetas - costoMercaderia;
    const productosSinCosto = [...productosSinCostoMap.values()]
      .map((p) => ({
        ...p,
        unidades: this.r2(p.unidades),
        ingreso: this.r2(p.ingreso),
      }))
      .sort((a, b) => b.ingreso - a.ingreso);

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
    const margenNeto =
      ingresosTotales > 0 ? (gananciaNeta / ingresosTotales) * 100 : 0;

    return {
      ventasNetas: this.r2(ventasNetas),
      ventasConIgv: this.r2(ventasConIgv),
      igvVentas: this.r2(igvVentas),
      costoBaseProductos: this.r2(costosProducto.costoBaseProductos),
      costosFijosProducto: this.r2(costosProducto.costosFijosProducto),
      costoMercaderia: this.r2(costoMercaderia),
      unidadesVendidas: this.r2(costosProducto.unidadesVendidas),
      lineasProducto: costosProducto.lineasProducto,
      lineasServicio: costosProducto.lineasServicio,
      productosSinCosto,
      gananciaBruta: this.r2(gananciaBruta),
      margenBruto: this.r2(margenBruto),
      otrosIngresos: this.r2(otrosIngresos),
      gastosTotales: this.r2(gastosTotales),
      gastoPublicidad: this.r2(gastoPublicidad),
      igvSunatCobrado: this.r2(Math.max(0, igvSunatCobrado)),
      gastosPorCategoria,
      gananciaNeta: this.r2(gananciaNeta),
      margenNeto: this.r2(margenNeto),
      resumenDiario,
    };
  }

  // ─── Public methods ──────────────────────────────────────────────────────────

  /** Fetches raw data for one period and returns calculated P&L. */
  private async fetchPeriodData(
    empresaId: number,
    periodo: PeriodoPnl,
    sedeId?: number | null,
    criterio: CriterioIgvVentas = 'ELECTRONICOS',
  ) {
    // Filtro por sede. Al pedir una sede concreta se traen solo sus ventas, sus
    // gastos de caja, sus gastos operativos, sus ingresos manuales y sus
    // campañas. Los registros con `sedeId` null son "de toda la empresa" y
    // quedan fuera: se informan aparte (ver `gastosEmpresa`) para que la suma
    // por sede más los de empresa cuadre con el consolidado.
    const porSede = sedeId ? { sedeId } : {};
    const range = { gte: periodo.gte, lte: periodo.lte };
    const gastoWhere = this.buildGastoRangoWhere(empresaId, periodo, sedeId);
    const [comprobantesRaw, gastos, campanas, ingresosManuales, egresosCaja] =
      await Promise.all([
        this.prisma.comprobante.findMany({
          where: {
            empresaId,
            ...porSede,
            fechaEmision: { gte: range.gte, lte: range.lte },
            ...this.filtroExcluirConvertidos,
          },
          select: {
            tipoDoc: true,
            estadoEnvioSunat: true,
            numDocAfectado: true,
            mtoImpVenta: true,
            mtoIGV: true,
            tipoMoneda: true,
            tipoCambio: true,
            fechaEmision: true,
            detalles: {
              select: {
                productoId: true,
                cantidad: true,
                mtoPrecioUnitario: true,
                unidadesPorPaquete: true,
                producto: {
                  select: {
                    descripcion: true,
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
            moneda: true,
            tipoCambio: true,
            fecha: true,
            recurrenteDiario: true,
            fechaInicio: true,
            fechaFin: true,
          },
        }),
        this.prisma.campanaMarketing.findMany({
          where: { empresaId, ...porSede },
          select: {
            nombre: true,
            plataforma: true,
            presupuestoDiario: true,
            fechaInicio: true,
            estado: true,
          },
        }),
        this.prisma.ingresoManual.findMany({
          where: {
            empresaId,
            ...porSede,
            fecha: { gte: range.gte, lte: range.lte },
            tipo: { notIn: this.TIPOS_FINANCIAMIENTO },
          },
          select: { concepto: true, tipo: true, monto: true },
          orderBy: { creadoEn: 'desc' },
        }),
        // Gastos de caja chica: son egresos reales del negocio y deben restar
        // en la utilidad igual que los gastos operativos. Viven en otra tabla
        // (MovimientoCaja), por eso se leen aparte.
        this.prisma.movimientoCaja.findMany({
          where: {
            ...egresosCajaWhere(empresaId, range.gte, range.lte),
            ...porSede,
          },
          select: { fecha: true, monto: true, categoriaGasto: true },
        }),
      ]);
    const comprobantes = await this.excluirNotasCreditoDeAnulacion(
      empresaId,
      comprobantesRaw,
    );
    const [comprasConsumo, creditoFiscal] = await Promise.all([
      this.comprasConsumoComoGastos(empresaId, range.gte, range.lte, sedeId),
      this.creditoFiscalCompras(empresaId, range.gte, range.lte, sedeId),
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
    const inicioMes = periodo.gte;
    const finMes = periodo.lte;
    const hoy = new Date();
    const finReal = hoy < finMes ? hoy : finMes;

    const gastosConCampanas: GastoPnl[] = [...gastos, ...comprasConsumo.gastos];
    // Cada gasto de caja aplica a un solo día (no hay recurrencia). La
    // categoría de caja es texto libre y se mapea al enum; el texto original
    // queda en `etiqueta` para que se vea de dónde salió.
    for (const e of egresosCaja) {
      // `monto` se envuelve como DecimalLike igual que las campañas, porque el
      // tipo GastoPnl espera un Decimal de Prisma, no un number plano.
      const montoCaja = Number(e.monto ?? 0);
      gastosConCampanas.push({
        categoria: mapCategoriaCaja(e.categoriaGasto),
        etiqueta: e.categoriaGasto?.trim()
          ? `Caja - ${e.categoriaGasto.trim()}`
          : 'Caja chica',
        monto: { toNumber: () => montoCaja },
        moneda: 'PEN',
        tipoCambio: null,
        fecha: e.fecha,
        recurrenteDiario: false,
        fechaInicio: null,
        fechaFin: null,
      });
    }
    for (const c of campanas) {
      if (c.estado === 'PAUSADA') continue;
      const inicio = c.fechaInicio > inicioMes ? c.fechaInicio : inicioMes;
      if (inicio > finReal) continue;
      const presupuesto = Number(c.presupuestoDiario);
      gastosConCampanas.push({
        categoria: 'PUBLICIDAD',
        etiqueta: `${c.plataforma} - ${c.nombre}`,
        monto: { toNumber: () => presupuesto },
        moneda: 'PEN',
        tipoCambio: null,
        fecha: null,
        recurrenteDiario: true,
        fechaInicio: inicio,
        fechaFin: finReal,
      });
    }

    // Gastos de toda la empresa (sin sede) que quedaron fuera por estar viendo
    // una sede concreta. Informativos: no restan en la utilidad de la sede,
    // pero el usuario tiene que saber que existen.
    let gastosEmpresa = 0;
    if (sedeId) {
      const [gastosSinSede, campanasSinSede, cajaSinSede] = await Promise.all([
        this.prisma.gastoOperativo.findMany({
          where: {
            ...this.buildGastoRangoWhere(empresaId, periodo),
            sedeId: null,
          },
          select: { monto: true, moneda: true, tipoCambio: true },
        }),
        this.prisma.campanaMarketing.findMany({
          where: { empresaId, sedeId: null },
          select: { presupuestoDiario: true, fechaInicio: true, estado: true },
        }),
        this.prisma.movimientoCaja.findMany({
          where: {
            ...egresosCajaWhere(empresaId, range.gte, range.lte),
            sedeId: null,
          },
          select: { monto: true },
        }),
      ]);
      gastosEmpresa =
        gastosSinSede.reduce((a, g) => a + this.toNumber(g.monto as any), 0) +
        cajaSinSede.reduce((a, m) => a + Number(m.monto ?? 0), 0) +
        campanasSinSede.reduce((a, c) => {
          if (c.estado === 'PAUSADA') return a;
          const ini = c.fechaInicio > inicioMes ? c.fechaInicio : inicioMes;
          if (ini > finReal) return a;
          const dias =
            Math.floor((finReal.getTime() - ini.getTime()) / 86400000) + 1;
          return a + Number(c.presupuestoDiario) * Math.max(dias, 0);
        }, 0);
    }

    const pnl = this.calcularPnl(
      comprobantes,
      gastosConCampanas,
      periodo,
      otrosIngresos,
      criterio,
    );
    const cobrado = pnl.igvSunatCobrado;
    const credito = creditoFiscal.igv;
    return {
      ...pnl,
      otrosIngresosDetalle,
      gastosEmpresa: this.r2(gastosEmpresa),
      comprasConsumo: this.r2(comprasConsumo.neto),
      comprasConsumoIgv: this.r2(comprasConsumo.igv),
      comprasConsumoCantidad: comprasConsumo.cantidad,
      igvSunat: {
        cobrado: this.r2(cobrado),
        creditoCompras: this.r2(credito),
        comprasConFactura: creditoFiscal.cantidad,
        aPagar: this.r2(Math.max(0, cobrado - credito)),
        saldoAFavor: this.r2(Math.max(0, credito - cobrado)),
        ahorro: this.r2(Math.min(cobrado, credito)),
      },
    };
  }

  /** GET /pnl — P&L for a single mes/anio period. */
  async getPnl(
    empresaId: number,
    opts: {
      mes?: number;
      anio?: number;
      /** Día (inicio = fin) o rango YYYY-MM-DD. Si viene, manda sobre mes/anio. */
      fechaInicio?: string;
      fechaFin?: string;
      sedeId?: number | null;
    },
  ): Promise<PnlResponse> {
    const now = new Date();
    const mes =
      opts.mes && opts.mes >= 1 && opts.mes <= 12
        ? opts.mes
        : now.getMonth() + 1;
    const anio = opts.anio && opts.anio >= 2020 ? opts.anio : now.getFullYear();
    const periodo =
      this.periodoRango(opts.fechaInicio, opts.fechaFin) ??
      this.periodoMes(mes, anio);
    const anterior = this.periodoAnterior(periodo);
    const sedeId = opts.sedeId;

    const criterio = await this.criterioIgvEmpresa(empresaId);
    const [pnl, pnlAnterior] = await Promise.all([
      this.fetchPeriodData(empresaId, periodo, sedeId, criterio),
      this.fetchPeriodData(empresaId, anterior, sedeId, criterio),
    ]);

    const tieneAnterior =
      pnlAnterior.ventasNetas > 0 ||
      pnlAnterior.gastosTotales > 0 ||
      pnlAnterior.otrosIngresos > 0;
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
      criterioIgv: criterio,
      criterioIgvLabel: CRITERIO_IGV_LABEL[criterio],
      periodo: {
        mes: periodo.mes,
        anio: periodo.anio,
        label: this.labelPeriodo(periodo),
        tipo: periodo.tipo,
        fechaInicio: periodo.startKey,
        fechaFin: periodo.endKey,
      },
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
    sedeId?: number | null,
  ): Promise<EvolucionPoint[]> {
    const porSede = sedeId ? { sedeId } : {};
    // Determine the N-month window
    const now = new Date();
    const mesActual = now.getMonth() + 1;
    const anioActual = now.getFullYear();

    const inicio = this.restarMeses(mesActual, anioActual, meses - 1);
    const rangeGte = this.periodoToRange(inicio.mes, inicio.anio).gte;
    const rangeLte = this.periodoToRange(mesActual, anioActual).lte;

    // Single query per entity covering the full window
    const criterio = await this.criterioIgvEmpresa(empresaId);
    const [comprobantesRaw, gastos, todosIngresosManuales] = await Promise.all([
      this.prisma.comprobante.findMany({
        where: {
          empresaId,
          ...porSede,
          fechaEmision: { gte: rangeGte, lte: rangeLte },
          ...this.filtroExcluirConvertidos,
        },
        select: {
          tipoDoc: true,
          estadoEnvioSunat: true,
          numDocAfectado: true,
          mtoImpVenta: true,
          mtoIGV: true,
          tipoMoneda: true,
          tipoCambio: true,
          fechaEmision: true,
          detalles: {
            select: {
              productoId: true,
              cantidad: true,
              unidadesPorPaquete: true,
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
    const comprobantes = await this.excluirNotasCreditoDeAnulacion(
      empresaId,
      comprobantesRaw,
    );
    const comprasVentana = (
      await this.comprasConsumoComoGastos(empresaId, rangeGte, rangeLte, sedeId)
    ).gastos;

    // Build result iterating backwards from current month
    const resultado: EvolucionPoint[] = [];

    for (let i = meses - 1; i >= 0; i--) {
      const { mes, anio } = this.restarMeses(mesActual, anioActual, i);
      const range = this.periodoToRange(mes, anio);

      const comprobantesDelMes = comprobantes.filter((c) => {
        const t = c.fechaEmision.getTime();
        return t >= range.gte.getTime() && t <= range.lte.getTime();
      });

      const gastosDelMes: GastoPnl[] = [
        ...gastos.filter(
          (g) =>
            (g.mes === mes && g.anio === anio) ||
            this.gastoRecurrenteCubrePeriodo(g, range.gte, range.lte),
        ),
        ...comprasVentana.filter((g) => {
          const t = g.fecha?.getTime() ?? 0;
          return t >= range.gte.getTime() && t <= range.lte.getTime();
        }),
      ];

      const otrosIngresosDelMes = todosIngresosManuales
        .filter((i) => {
          const t = i.fecha.getTime();
          return t >= range.gte.getTime() && t <= range.lte.getTime();
        })
        .reduce((sum, i) => sum + this.toNumber(i.monto as any), 0);

      const pnl = this.calcularPnl(
        comprobantesDelMes,
        gastosDelMes,
        this.periodoMes(mes, anio),
        otrosIngresosDelMes,
        criterio,
      );

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

  /**
   * @param sedeId cuando se pide una sede concreta se traen SOLO los gastos de
   *   esa sede. Los gastos con `sedeId` null son "de toda la empresa" y no se
   *   le cargan a ninguna sede — se informan aparte. Así la suma de los gastos
   *   por sede más los de empresa cuadra con el consolidado.
   */
  private buildGastoPeriodoWhere(
    empresaId: number,
    mes: number,
    anio: number,
    sedeId?: number | null,
  ) {
    const range = this.periodoToRange(mes, anio);
    return {
      empresaId,
      ...(sedeId ? { sedeId } : {}),
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

  /**
   * Gastos operativos del período. Mes: criterio histórico (mes/anio o
   * recurrente que lo cubre). Día/rango: gastos fechados dentro del rango o
   * recurrentes que lo cubren.
   */
  private buildGastoRangoWhere(
    empresaId: number,
    periodo: PeriodoPnl,
    sedeId?: number | null,
  ) {
    if (periodo.tipo === 'mes') {
      return this.buildGastoPeriodoWhere(
        empresaId,
        periodo.mes,
        periodo.anio,
        sedeId,
      );
    }
    return {
      empresaId,
      ...(sedeId ? { sedeId } : {}),
      OR: [
        {
          recurrenteDiario: false,
          fecha: { gte: periodo.gte, lte: periodo.lte },
        },
        {
          recurrenteDiario: true,
          fechaInicio: { lte: periodo.lte },
          OR: [{ fechaFin: null }, { fechaFin: { gte: periodo.gte } }],
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
    sedeId?: number | null,
  ): Promise<GastoOperativo[]> {
    const gastoWhere = this.buildGastoPeriodoWhere(
      empresaId,
      mes,
      anio,
      sedeId,
    );
    const range = this.periodoToRange(mes, anio);
    const [operativos, movsCaja] = await Promise.all([
      this.prisma.gastoOperativo.findMany({
        where: gastoWhere,
        orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
      }),
      this.prisma.movimientoCaja.findMany({
        where: {
          ...egresosCajaWhere(empresaId, range.gte, range.lte),
          ...(sedeId ? { sedeId } : {}),
        },
        select: EGRESO_CAJA_SELECT,
        orderBy: { fecha: 'desc' },
      }),
    ]);
    // Los de caja van marcados `editable: false`: se corrigen en Caja, no acá.
    return [
      ...operativos.map((g) => ({ ...g, origen: 'OPERATIVO', editable: true })),
      ...movsCaja.map(normalizarEgresoCaja),
    ] as any;
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

  async getRentabilidadCategorias(
    empresaId: number,
    mes?: number,
    anio?: number,
    sedeId?: number | null,
    fechaInicio?: string,
    fechaFin?: string,
  ) {
    // Mismo criterio que getMetodosPago/getProductosVendidos: si llega un
    // rango explícito (filtro "Día" o "Rango") manda; si no, el mes/año.
    const now = new Date();
    const mesFinal = mes && mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1;
    const anioFinal =
      anio && anio >= 2020 && anio <= 2100 ? anio : now.getFullYear();
    const range =
      this.fechasToRange(fechaInicio, fechaFin) ??
      this.periodoToRange(mesFinal, anioFinal);
    // Un solo día se etiqueta con la fecha sola (este label sale en el PDF).
    const periodoLabel =
      fechaInicio && fechaFin
        ? fechaInicio === fechaFin
          ? fechaInicio
          : `${fechaInicio} al ${fechaFin}`
        : `${this.mesLabel(mesFinal)} ${anioFinal}`;

    const comprobantesRaw = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fechaEmision: { gte: range.gte, lte: range.lte },
        ...this.filtroExcluirConvertidos,
      },
      select: {
        tipoDoc: true,
        estadoEnvioSunat: true,
        numDocAfectado: true,
        detalles: {
          select: {
            descripcion: true,
            cantidad: true,
            mtoPrecioUnitario: true,
            mtoValorVenta: true,
            tipAfeIgv: true,
            productoId: true,
            unidadesPorPaquete: true,
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
    const criterio = await this.criterioIgvEmpresa(empresaId);
    const comprobantes = await this.excluirNotasCreditoDeAnulacion(
      empresaId,
      comprobantesRaw,
    );

    // catKey → { prodKey → accumulator }
    const catMap = new Map<
      string,
      Map<
        string,
        {
          nombre: string;
          ingreso: number;
          ventaConIgv: number;
          costo: number;
          unidades: number;
        }
      >
    >();

    for (const comp of comprobantes) {
      if (comp.estadoEnvioSunat === 'ANULADO' || comp.tipoDoc === 'COT')
        continue;
      const signo: 1 | -1 = comp.tipoDoc === '07' ? -1 : 1;

      for (const det of comp.detalles) {
        const catNombre = det.producto?.categoria?.nombre ?? 'Sin categoría';
        const prodNombre =
          det.producto?.descripcion ?? det.descripcion ?? 'Producto';
        const prodKey = String(det.productoId ?? prodNombre);
        // Paquete vendido como UNA línea (Empresa.paquetesComoUnaLinea): la
        // cantidad facturada (p.ej. 1 caja) se usa para el ingreso (ya viene
        // al precio completo del paquete), pero el costo y las unidades deben
        // reflejar las unidades reales = cantidad × unidadesPorPaquete.
        const uPaquete = Number(det.unidadesPorPaquete) || 1;
        const cantidadFacturada = (det.cantidad ?? 0) * signo;
        const qty = cantidadFacturada * uPaquete;
        // Ingreso sin el IGV declarado, igual que las ventas netas del P&L.
        const ingresoLinea =
          this.ingresoLineaSinIgv(comp.tipoDoc, det, criterio) * signo;
        const ventaLinea = this.ventaLineaConIgv(det) * signo;
        const costoUnit =
          this.toNumber(det.producto?.costoPromedio) +
          this.toNumber(det.producto?.costoFijo);

        if (!catMap.has(catNombre)) catMap.set(catNombre, new Map());
        const prodMap = catMap.get(catNombre)!;

        if (!prodMap.has(prodKey)) {
          prodMap.set(prodKey, {
            nombre: prodNombre,
            ingreso: 0,
            ventaConIgv: 0,
            costo: 0,
            unidades: 0,
          });
        }
        const acc = prodMap.get(prodKey)!;
        acc.ingreso += ingresoLinea;
        acc.ventaConIgv += ventaLinea;
        acc.costo += costoUnit * qty;
        acc.unidades += qty;
      }
    }

    const categorias = [...catMap.entries()]
      .map(([catNombre, prodMap]) => {
        const productos = [...prodMap.values()]
          .map((p) => {
            const gananciaTotal = this.r2(p.ingreso - p.costo);
            const margen =
              p.ingreso > 0
                ? this.r2(((p.ingreso - p.costo) / p.ingreso) * 100)
                : 0;
            return {
              nombre: p.nombre,
              precioUnitario: this.r2(
                p.unidades !== 0 ? p.ingreso / p.unidades : 0,
              ),
              costoUnitario: this.r2(
                p.unidades !== 0 ? p.costo / p.unidades : 0,
              ),
              margen,
              unidadesVendidas: this.r2(p.unidades),
              ingresoTotal: this.r2(p.ingreso),
              ventasConIgv: this.r2(p.ventaConIgv),
              gananciaTotal,
            };
          })
          .sort((a, b) => b.gananciaTotal - a.gananciaTotal);

        const ingresoTotal = this.r2(
          productos.reduce((s, p) => s + p.ingresoTotal, 0),
        );
        const ventasConIgv = this.r2(
          productos.reduce((s, p) => s + p.ventasConIgv, 0),
        );
        const gananciaTotal = this.r2(
          productos.reduce((s, p) => s + p.gananciaTotal, 0),
        );
        const unidadesVendidas = this.r2(
          productos.reduce((s, p) => s + p.unidadesVendidas, 0),
        );
        const margenPromedio =
          ingresoTotal > 0 ? this.r2((gananciaTotal / ingresoTotal) * 100) : 0;

        return {
          nombre: catNombre,
          ingresoTotal,
          ventasConIgv,
          gananciaTotal,
          margenPromedio,
          unidadesVendidas,
          cantidadProductos: productos.length,
          productos,
        };
      })
      .sort((a, b) => b.gananciaTotal - a.gananciaTotal);

    const ingresoTotal = this.r2(
      categorias.reduce((s, c) => s + c.ingresoTotal, 0),
    );
    const ventasConIgv = this.r2(
      categorias.reduce((s, c) => s + c.ventasConIgv, 0),
    );
    const gananciaTotal = this.r2(
      categorias.reduce((s, c) => s + c.gananciaTotal, 0),
    );
    const margenPromedio =
      ingresoTotal > 0 ? this.r2((gananciaTotal / ingresoTotal) * 100) : 0;

    return {
      periodo: {
        mes: mesFinal,
        anio: anioFinal,
        fechaInicio: fechaInicio ?? null,
        fechaFin: fechaFin ?? null,
        label: periodoLabel,
      },
      ingresoTotal,
      ventasConIgv,
      gananciaTotal,
      margenPromedio,
      totalCategorias: categorias.length,
      mejorCategoria: categorias[0]?.nombre ?? null,
      categorias,
    };
  }

  /**
   * Ventas por producto del período, con acumulado por día.
   *
   * Comparte las reglas contables del P&L y de la vista por categorías: excluye
   * anulados y cotizaciones, resta las notas de crédito (tipoDoc 07) y toma el
   * costo como `costoPromedio + costoFijo`. A diferencia de categorías, el
   * ingreso se normaliza a soles con el tipo de cambio del comprobante.
   *
   * Acepta mes/anio o un rango de fechas (fechaInicio/fechaFin manda).
   */
  /**
   * Análisis de clientes y envíos: ciudades que más compran, ranking de
   * clientes, cliente más fiel y ranking de repartidores/couriers (Shalom,
   * Olva, otros). Mismo período/sede que el resto del análisis financiero.
   *
   * · Ingreso = mtoImpVenta en soles (notas de crédito restan), sin anuladas ni
   *   cotizaciones/OT, sin doble conteo de informales convertidos.
   * · Ciudad: primero el destino del envío (rastreo Shalom → agencia destino →
   *   dirección de entrega) porque es el dato que sí se llena en el día a día;
   *   si la venta no tuvo envío, la ubicación registrada del cliente. Sin nada
   *   de eso cae en "Sin ciudad registrada".
   * · Fidelidad = cantidad de compras; desempata por meses distintos con compra
   *   y por recencia de la última compra.
   * · Repartidores/couriers salen de EnvioDespacho: entregado = estado ENTREGADO
   *   o la bandera de rastreo del courier (shalomEntregado / olvaEntregado).
   */
  async getAnalisisClientes(
    empresaId: number,
    mes?: number,
    anio?: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number | null,
  ): Promise<AnalisisClientesResponse> {
    const now = new Date();
    const mesFinal = mes && mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1;
    const anioFinal =
      anio && anio >= 2020 && anio <= 2100 ? anio : now.getFullYear();
    const rangoFechas = this.fechasToRange(fechaInicio, fechaFin);
    const range = rangoFechas ?? this.periodoToRange(mesFinal, anioFinal);
    const label = rangoFechas
      ? fechaInicio === fechaFin
        ? String(fechaInicio)
        : `${fechaInicio} al ${fechaFin}`
      : `${this.mesLabel(mesFinal)} ${anioFinal}`;

    const comprobantesRaw = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fechaEmision: { gte: range.gte, lte: range.lte },
        ...this.filtroExcluirConvertidos,
      },
      select: {
        id: true,
        tipoDoc: true,
        estadoEnvioSunat: true,
        numDocAfectado: true,
        fechaEmision: true,
        tipoMoneda: true,
        tipoCambio: true,
        mtoImpVenta: true,
        clienteId: true,
        cliente: {
          select: {
            id: true,
            nombre: true,
            nroDoc: true,
            departamento: true,
            provincia: true,
            distrito: true,
          },
        },
        envioDespacho: {
          select: {
            transportista: true,
            agenciaDestino: true,
            direccionDestino: true,
            shalomTrackingJson: true,
            estado: true,
            shalomEntregado: true,
            olvaEntregado: true,
            shalomEstado: true,
            olvaEstado: true,
            costoEnvio: true,
            repartidorId: true,
            repartidor: { select: { nombre: true, tipo: true } },
          },
        },
      },
    });
    const comprobantes = await this.excluirNotasCreditoDeAnulacion(
      empresaId,
      comprobantesRaw,
    );

    const limpiar = (v?: string | null) =>
      String(v ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    const SIN_CIUDAD = 'Sin ciudad registrada';
    // Abreviaturas que las cajeras usan como destino en Lima.
    const ALIAS_DISTRITO: Record<string, string> = {
      SMP: 'SAN MARTIN DE PORRES',
      SJL: 'SAN JUAN DE LURIGANCHO',
      SJM: 'SAN JUAN DE MIRAFLORES',
      VMT: 'VILLA MARIA DEL TRIUNFO',
      VES: 'VILLA EL SALVADOR',
      CERCADO: 'CERCADO DE LIMA',
      LIMA: 'CERCADO DE LIMA',
    };
    const armarUbicacion = (
      distrito: string,
      provincia: string,
      departamento: string,
    ) => {
      const ciudad =
        distrito && provincia && distrito !== provincia
          ? `${distrito}, ${provincia}`
          : distrito || provincia || departamento || SIN_CIUDAD;
      return {
        ciudad,
        departamento: departamento || null,
        provincia: provincia || null,
        distrito: distrito || null,
      };
    };
    const ubicacionCliente = (
      c: (typeof comprobantes)[number]['cliente'] | null,
    ) =>
      armarUbicacion(
        limpiar(c?.distrito),
        limpiar(c?.provincia),
        limpiar(c?.departamento),
      );
    /** Destino del envío: rastreo Shalom → agencia destino → dirección de entrega. */
    const ubicacionEnvio = (
      env: (typeof comprobantes)[number]['envioDespacho'],
    ) => {
      if (!env) return null;
      const destino = (env.shalomTrackingJson as any)?.order?.destino;
      if (destino?.distrito || destino?.provincia) {
        return armarUbicacion(
          limpiar(destino.distrito),
          limpiar(destino.provincia),
          limpiar(destino.departamento),
        );
      }
      const agencia = limpiar(env.agenciaDestino);
      if (agencia) {
        // Formato Shalom/Olva: "AGENCIA - PROVINCIA - DEPARTAMENTO".
        const partes = agencia
          .split(' - ')
          .map((x) => x.trim())
          .filter(Boolean);
        if (partes.length >= 3) {
          const departamento = partes[partes.length - 1];
          const provincia = partes[partes.length - 2];
          return armarUbicacion(provincia, provincia, departamento);
        }
        // Reparto propio: la cajera escribe el distrito de Lima.
        const distrito = ALIAS_DISTRITO[agencia] ?? agencia;
        return armarUbicacion(distrito, 'LIMA', 'LIMA');
      }
      const direccion = limpiar(env.direccionDestino);
      if (direccion && direccion.length <= 30 && !/\d/.test(direccion)) {
        const distrito = ALIAS_DISTRITO[direccion] ?? direccion;
        return armarUbicacion(distrito, 'LIMA', 'LIMA');
      }
      return null;
    };
    const esClientesVarios = (nroDoc?: string | null, nombre?: string | null) =>
      !nroDoc ||
      /^0+$|^10000000$|^99999999$/.test(String(nroDoc)) ||
      /CLIENTES? VARIOS/i.test(String(nombre ?? ''));

    interface AccCliente extends ClienteRanking {
      meses: Set<string>;
      primera: Date | null;
      ultima: Date | null;
    }
    interface AccCiudad extends CiudadRanking {
      clientesSet: Set<string>;
    }
    const cliMap = new Map<string, AccCliente>();
    const ciuMap = new Map<string, AccCiudad>();
    const repMap = new Map<string, RepartidorRanking>();
    const courMap = new Map<string, CourierRanking>();
    let ingresoTotal = 0;
    let documentos = 0;
    let envios = 0;
    let enviosEntregados = 0;

    const nombreCourier = (transportista?: string | null) => {
      const t = limpiar(transportista);
      if (!t) return 'Sin courier';
      if (t.includes('SHALOM')) return 'Shalom';
      if (t.includes('OLVA')) return 'Olva';
      return t.charAt(0) + t.slice(1).toLowerCase();
    };

    for (const comp of comprobantes) {
      if (comp.estadoEnvioSunat === 'ANULADO') continue;
      const signo: 1 | -1 = comp.tipoDoc === '07' ? -1 : 1;
      const monto =
        montoEnPen(
          comp.mtoImpVenta,
          comp.tipoMoneda,
          this.toNumber(comp.tipoCambio),
        ) * signo;
      ingresoTotal += monto;
      documentos += 1;
      const fecha = comp.fechaEmision ?? null;
      const mesKey = this.fechaLimaKey(fecha ?? undefined)?.slice(0, 7);

      // ── Cliente ──
      const cli = comp.cliente;
      const varios = esClientesVarios(cli?.nroDoc, cli?.nombre);
      const cliKey = varios
        ? 'varios'
        : String(cli?.id ?? comp.clienteId ?? 'varios');
      const ubiCliente = ubicacionCliente(varios ? null : cli);
      const ubi =
        ubiCliente.ciudad !== SIN_CIUDAD
          ? ubiCliente
          : (ubicacionEnvio(comp.envioDespacho) ?? ubiCliente);
      if (!cliMap.has(cliKey)) {
        cliMap.set(cliKey, {
          clienteId: varios ? null : (cli?.id ?? comp.clienteId ?? null),
          nombre: varios ? 'CLIENTES VARIOS' : (cli?.nombre ?? 'Cliente'),
          nroDoc: varios ? null : (cli?.nroDoc ?? null),
          ciudad: ubi.ciudad,
          compras: 0,
          ingreso: 0,
          ticketPromedio: 0,
          primeraCompra: null,
          ultimaCompra: null,
          mesesActivos: 0,
          diasDesdeUltima: null,
          meses: new Set(),
          primera: null,
          ultima: null,
        });
      }
      const acc = cliMap.get(cliKey)!;
      if (signo > 0) acc.compras += 1;
      acc.ingreso += monto;
      if (mesKey) acc.meses.add(mesKey);
      if (fecha) {
        if (!acc.primera || fecha < acc.primera) acc.primera = fecha;
        if (!acc.ultima || fecha > acc.ultima) acc.ultima = fecha;
      }

      // ── Ciudad ──
      if (!ciuMap.has(ubi.ciudad)) {
        ciuMap.set(ubi.ciudad, {
          ...ubi,
          compras: 0,
          clientes: 0,
          ingreso: 0,
          participacion: 0,
          clientesSet: new Set(),
        });
      }
      const ciu = ciuMap.get(ubi.ciudad)!;
      if (signo > 0) ciu.compras += 1;
      ciu.ingreso += monto;
      ciu.clientesSet.add(cliKey);

      // ── Envío (repartidor + courier) ──
      const env = comp.envioDespacho;
      if (env) {
        envios += 1;
        const entregado =
          env.estado === 'ENTREGADO' ||
          env.shalomEntregado ||
          env.olvaEntregado;
        const devuelto = env.estado === 'DEVUELTO';
        if (entregado) enviosEntregados += 1;
        const costo = this.toNumber(env.costoEnvio);

        const repKey = env.repartidorId
          ? String(env.repartidorId)
          : nombreCourier(env.transportista);
        if (!repMap.has(repKey)) {
          repMap.set(repKey, {
            repartidorId: env.repartidorId ?? null,
            nombre: env.repartidor?.nombre ?? nombreCourier(env.transportista),
            tipo: env.repartidor?.tipo ?? (env.repartidorId ? null : 'COURIER'),
            envios: 0,
            entregados: 0,
            devueltos: 0,
            tasaEntrega: 0,
            costoEnvio: 0,
            ingreso: 0,
          });
        }
        const rep = repMap.get(repKey)!;
        rep.envios += 1;
        if (entregado) rep.entregados += 1;
        if (devuelto) rep.devueltos += 1;
        rep.costoEnvio += costo;
        rep.ingreso += monto;

        const cKey = nombreCourier(env.transportista);
        if (!courMap.has(cKey)) {
          courMap.set(cKey, {
            courier: cKey,
            envios: 0,
            entregados: 0,
            enTransito: 0,
            devueltos: 0,
            tasaEntrega: 0,
            costoEnvio: 0,
          });
        }
        const cour = courMap.get(cKey)!;
        cour.envios += 1;
        if (entregado) cour.entregados += 1;
        else if (devuelto) cour.devueltos += 1;
        else cour.enTransito += 1;
        cour.costoEnvio += costo;
      }
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const hoy = Date.now();
    const clientes: ClienteRanking[] = Array.from(cliMap.values())
      .map(({ meses, primera, ultima, ...c }) => ({
        ...c,
        ingreso: r2(c.ingreso),
        ticketPromedio: c.compras > 0 ? r2(c.ingreso / c.compras) : 0,
        primeraCompra: primera ? primera.toISOString() : null,
        ultimaCompra: ultima ? ultima.toISOString() : null,
        mesesActivos: meses.size,
        diasDesdeUltima: ultima
          ? Math.max(0, Math.floor((hoy - ultima.getTime()) / 86400000))
          : null,
      }))
      .sort((a, b) => b.ingreso - a.ingreso || b.compras - a.compras);

    // Cliente más fiel: excluye "CLIENTES VARIOS" (no es una persona) y exige al
    // menos 2 compras; si nadie repite, no hay fiel que mostrar.
    const clienteMasFiel =
      clientes
        .filter((c) => c.clienteId !== null && c.compras >= 2)
        .sort(
          (a, b) =>
            b.compras - a.compras ||
            b.mesesActivos - a.mesesActivos ||
            (a.diasDesdeUltima ?? 1e9) - (b.diasDesdeUltima ?? 1e9) ||
            b.ingreso - a.ingreso,
        )[0] ?? null;

    const ciudades: CiudadRanking[] = Array.from(ciuMap.values())
      .map(({ clientesSet, ...c }) => ({
        ...c,
        clientes: clientesSet.size,
        ingreso: r2(c.ingreso),
        participacion:
          ingresoTotal > 0 ? r2((c.ingreso / ingresoTotal) * 100) : 0,
      }))
      .sort((a, b) => b.ingreso - a.ingreso || b.compras - a.compras);

    const repartidores = Array.from(repMap.values())
      .map((r) => ({
        ...r,
        costoEnvio: r2(r.costoEnvio),
        ingreso: r2(r.ingreso),
        tasaEntrega: r.envios > 0 ? r2((r.entregados / r.envios) * 100) : 0,
      }))
      .sort((a, b) => b.entregados - a.entregados || b.envios - a.envios);

    const couriers = Array.from(courMap.values())
      .map((c) => ({
        ...c,
        costoEnvio: r2(c.costoEnvio),
        tasaEntrega: c.envios > 0 ? r2((c.entregados / c.envios) * 100) : 0,
      }))
      .sort((a, b) => b.envios - a.envios);

    const clientesReales = clientes.filter((c) => c.clienteId !== null);
    return {
      periodo: {
        mes: mesFinal,
        anio: anioFinal,
        fechaInicio: fechaInicio ?? null,
        fechaFin: fechaFin ?? null,
        label,
      },
      resumen: {
        ingresoTotal: r2(ingresoTotal),
        documentos,
        clientesDistintos: clientesReales.length,
        clientesRecurrentes: clientesReales.filter((c) => c.compras >= 2)
          .length,
        ticketPromedio: documentos > 0 ? r2(ingresoTotal / documentos) : 0,
        ciudadesDistintas: ciudades.filter((c) => c.ciudad !== SIN_CIUDAD)
          .length,
        envios,
        enviosEntregados,
      },
      ciudades,
      clientes,
      clienteMasFiel,
      repartidores,
      couriers,
    };
  }

  /**
   * Tablero de couriers (Shalom / Olva / propios): volumen, tasa de entrega,
   * tiempos, flete, destinos y los envíos en curso con su etapa de rastreo.
   * Lee EnvioDespacho de los comprobantes del período (misma sede/rango que el
   * resto del análisis). "Entregado" = estado ENTREGADO o la bandera del
   * courier; "retrasado" = en curso y pasó la fecha estimada (o > 7 días).
   */
  async getAnalisisCouriers(
    empresaId: number,
    mes?: number,
    anio?: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number | null,
  ): Promise<AnalisisCouriersResponse> {
    const now = new Date();
    const mesFinal = mes && mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1;
    const anioFinal =
      anio && anio >= 2020 && anio <= 2100 ? anio : now.getFullYear();
    const rangoFechas = this.fechasToRange(fechaInicio, fechaFin);
    const range = rangoFechas ?? this.periodoToRange(mesFinal, anioFinal);
    const label = rangoFechas
      ? fechaInicio === fechaFin
        ? String(fechaInicio)
        : `${fechaInicio} al ${fechaFin}`
      : `${this.mesLabel(mesFinal)} ${anioFinal}`;

    const envios = await this.prisma.envioDespacho.findMany({
      where: {
        comprobante: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          fechaEmision: { gte: range.gte, lte: range.lte },
          estadoEnvioSunat: { not: 'ANULADO' },
        },
      },
      select: {
        id: true,
        transportista: true,
        estado: true,
        agenciaDestino: true,
        direccionDestino: true,
        nroOrden: true,
        claveOrden: true,
        costoEnvio: true,
        montoCOD: true,
        fechaEstimada: true,
        creadoEn: true,
        actualizadoEn: true,
        historial: true,
        shalomEstado: true,
        shalomEntregado: true,
        shalomTrackingJson: true,
        shalomSyncAt: true,
        olvaEstado: true,
        olvaEntregado: true,
        olvaTrackingJson: true,
        olvaSyncAt: true,
        repartidor: { select: { nombre: true } },
        comprobante: {
          select: {
            id: true,
            serie: true,
            correlativo: true,
            tipoDoc: true,
            fechaEmision: true,
            mtoImpVenta: true,
            tipoMoneda: true,
            tipoCambio: true,
            cliente: { select: { nombre: true, telefono: true } },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });

    const limpiar = (v?: string | null) =>
      String(v ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    const nombreCourier = (t?: string | null) => {
      const u = limpiar(t);
      if (!u) return 'Sin courier';
      if (u.includes('SHALOM')) return 'Shalom';
      if (u.includes('OLVA')) return 'Olva';
      if (u.includes('PROPIO')) return 'Propios';
      return u.charAt(0) + u.slice(1).toLowerCase();
    };
    const ETIQUETA: Record<string, string> = {
      registrado: 'Registrado',
      origen: 'En origen',
      transito: 'En tránsito',
      reparto: 'En reparto',
      destino: 'En agencia destino',
      entregado: 'Entregado',
      PREPARANDO: 'Preparando',
      EN_CAMINO: 'En camino',
      EN_AGENCIA: 'En agencia',
      EN_DESTINO: 'En destino',
      ENTREGADO: 'Entregado',
      DEVUELTO: 'Devuelto',
    };
    interface DestinoEnvio {
      destino: string;
      departamento: string | null;
      provincia: string | null;
      distrito: string | null;
    }
    const destinoDe = (e: (typeof envios)[number]): DestinoEnvio => {
      const dest = (e.shalomTrackingJson as any)?.order?.destino;
      if (dest?.provincia || dest?.distrito) {
        const distrito = limpiar(dest.distrito);
        const provincia = limpiar(dest.provincia);
        return {
          destino:
            distrito && provincia && distrito !== provincia
              ? `${distrito}, ${provincia}`
              : distrito || provincia,
          departamento: limpiar(dest.departamento) || null,
          provincia: provincia || null,
          distrito: distrito || null,
        };
      }
      const olvaDest =
        (e.olvaTrackingJson as any)?.data?.destination ??
        (e.olvaTrackingJson as any)?.destination;
      if (olvaDest?.agency) {
        const agency = limpiar(olvaDest.agency);
        return {
          destino: agency,
          departamento: limpiar(olvaDest.department) || null,
          provincia: null,
          distrito: agency.replace(/ CENTRO$/, ''),
        };
      }
      const agencia = limpiar(e.agenciaDestino);
      if (agencia) {
        const partes = agencia
          .split(' - ')
          .map((x) => x.trim())
          .filter(Boolean);
        if (partes.length >= 3)
          return {
            destino: partes[partes.length - 2],
            departamento: partes[partes.length - 1],
            provincia: partes[partes.length - 2],
            distrito: null,
          };
        return {
          destino: agencia,
          departamento: null,
          provincia: null,
          distrito: agencia,
        };
      }
      const dir = limpiar(e.direccionDestino);
      const distrito = dir.includes(',') ? dir.split(',').pop()!.trim() : dir;
      return {
        destino: dir || 'Sin destino',
        departamento: null,
        provincia: null,
        distrito: distrito || null,
      };
    };
    const fechaDe = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(String(v).replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const fechaEntregaDe = (e: (typeof envios)[number]): Date | null => {
      const sh = fechaDe(
        (e.shalomTrackingJson as any)?.statuses?.entregado?.fecha,
      );
      if (sh) return sh;
      const ol = fechaDe((e.olvaTrackingJson as any)?.data?.deliveredAt);
      if (ol) return ol;
      const hist = Array.isArray(e.historial) ? (e.historial as any[]) : [];
      const h = hist.find((x) => x?.estado === 'ENTREGADO');
      return fechaDe(h?.fecha);
    };

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const hoy = Date.now();
    const items: EnvioCourierItem[] = [];
    const porCourier = new Map<
      string,
      CourierResumen & { horasSum: number; horasN: number }
    >();
    const diaMap = new Map<string, Record<string, number>>();
    const destMap = new Map<
      string,
      DestinoEnvio & {
        envios: number;
        entregados: number;
        costoEnvio: number;
        couriers: Map<string, number>;
      }
    >();
    const acumular = (courier: string) => {
      if (!porCourier.has(courier)) {
        porCourier.set(courier, {
          courier,
          envios: 0,
          entregados: 0,
          enCurso: 0,
          devueltos: 0,
          tasaEntrega: 0,
          costoEnvio: 0,
          costoPromedio: 0,
          ingreso: 0,
          horasPromedioEntrega: null,
          montoCOD: 0,
          etapas: {},
          horasSum: 0,
          horasN: 0,
        });
      }
      return porCourier.get(courier)!;
    };

    for (const e of envios) {
      const courier = nombreCourier(e.transportista);
      const entregado =
        e.estado === 'ENTREGADO' || e.shalomEntregado || e.olvaEntregado;
      const devuelto = e.estado === 'DEVUELTO';
      const enCurso = !entregado && !devuelto;
      const etapa = entregado
        ? 'entregado'
        : courier === 'Shalom'
          ? e.shalomEstado
          : courier === 'Olva'
            ? e.olvaEstado
            : null;
      const etapaLabel = entregado
        ? 'Entregado'
        : devuelto
          ? 'Devuelto'
          : (ETIQUETA[etapa ?? ''] ?? ETIQUETA[e.estado] ?? e.estado);
      const costo = this.toNumber(e.costoEnvio);
      const total = montoEnPen(
        e.comprobante.mtoImpVenta,
        e.comprobante.tipoMoneda,
        this.toNumber(e.comprobante.tipoCambio),
      );
      const fechaEnvio = e.comprobante.fechaEmision ?? e.creadoEn;
      const diasEnCamino = Math.max(
        0,
        Math.floor((hoy - new Date(fechaEnvio).getTime()) / 86400000),
      );
      const retrasado =
        enCurso &&
        ((e.fechaEstimada &&
          new Date(e.fechaEstimada).getTime() + 86400000 < hoy) ||
          diasEnCamino > 7);
      const ubicacion = destinoDe(e);
      const { destino, departamento } = ubicacion;

      const c = acumular(courier);
      c.envios += 1;
      c.costoEnvio += costo;
      c.ingreso += total;
      c.montoCOD += this.toNumber(e.montoCOD);
      if (entregado) {
        c.entregados += 1;
        const fe = fechaEntregaDe(e);
        if (fe) {
          const horas =
            (fe.getTime() - new Date(fechaEnvio).getTime()) / 3600000;
          if (horas > 0 && horas < 24 * 60) {
            c.horasSum += horas;
            c.horasN += 1;
          }
        }
      } else if (devuelto) c.devueltos += 1;
      else {
        c.enCurso += 1;
        const k = etapa ?? e.estado;
        c.etapas[k] = (c.etapas[k] ?? 0) + 1;
      }

      const diaKey = this.fechaLimaKey(fechaEnvio ?? undefined);
      if (diaKey) {
        if (!diaMap.has(diaKey)) diaMap.set(diaKey, {});
        const d = diaMap.get(diaKey)!;
        d[courier] = (d[courier] ?? 0) + 1;
      }

      const dk = `${destino}|${departamento ?? ''}`;
      if (!destMap.has(dk))
        destMap.set(dk, {
          ...ubicacion,
          envios: 0,
          entregados: 0,
          costoEnvio: 0,
          couriers: new Map(),
        });
      const dm = destMap.get(dk)!;
      dm.envios += 1;
      if (entregado) dm.entregados += 1;
      dm.costoEnvio += costo;
      dm.couriers.set(courier, (dm.couriers.get(courier) ?? 0) + 1);

      items.push({
        envioId: e.id,
        comprobanteId: e.comprobante.id,
        documento: `${e.comprobante.serie}-${String(e.comprobante.correlativo).padStart(8, '0')}`,
        fecha: new Date(fechaEnvio).toISOString(),
        cliente: e.comprobante.cliente?.nombre ?? 'CLIENTES VARIOS',
        telefono: e.comprobante.cliente?.telefono ?? null,
        courier,
        transportista: e.transportista,
        nroOrden: e.nroOrden || null,
        claveOrden: e.claveOrden || null,
        destino,
        departamento,
        estado: e.estado,
        etapa: etapa ?? null,
        etapaLabel,
        entregado: Boolean(entregado),
        devuelto,
        fechaEstimada: e.fechaEstimada
          ? new Date(e.fechaEstimada).toISOString()
          : null,
        diasEnCamino,
        retrasado: Boolean(retrasado),
        costoEnvio: r2(costo),
        montoCOD: e.montoCOD != null ? r2(this.toNumber(e.montoCOD)) : null,
        total: r2(total),
        repartidor: e.repartidor?.nombre ?? null,
        ultimaActualizacion:
          (e.shalomSyncAt ?? e.olvaSyncAt ?? e.actualizadoEn)?.toISOString() ??
          null,
      });
    }

    const couriers: CourierResumen[] = Array.from(porCourier.values())
      .map(({ horasSum, horasN, ...c }) => ({
        ...c,
        costoEnvio: r2(c.costoEnvio),
        costoPromedio: c.envios > 0 ? r2(c.costoEnvio / c.envios) : 0,
        ingreso: r2(c.ingreso),
        montoCOD: r2(c.montoCOD),
        tasaEntrega: c.envios > 0 ? r2((c.entregados / c.envios) * 100) : 0,
        horasPromedioEntrega: horasN > 0 ? r2(horasSum / horasN) : null,
      }))
      .sort((a, b) => b.envios - a.envios);

    const nombresCouriers = couriers.map((c) => c.courier);
    const serieDiaria = Array.from(diaMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, conteo]) => {
        const fila: any = { fecha };
        for (const n of nombresCouriers) fila[n] = conteo[n] ?? 0;
        return fila;
      });

    const destinos = Array.from(destMap.values())
      .filter((d) => d.destino !== 'Sin destino')
      .map((d) => {
        const principal =
          Array.from(d.couriers.entries()).sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0] ?? '-';
        const coord = coordenadasDeDestino(d);
        return {
          destino: d.destino,
          departamento: d.departamento,
          provincia: d.provincia,
          distrito: d.distrito,
          envios: d.envios,
          entregados: d.entregados,
          costoEnvio: r2(d.costoEnvio),
          courierPrincipal: principal,
          lat: coord?.lat ?? null,
          lng: coord?.lng ?? null,
        };
      })
      .sort((a, b) => b.envios - a.envios)
      .slice(0, 40);

    const enCursoItems = items
      .filter((i) => !i.entregado && !i.devuelto)
      .sort(
        (a, b) =>
          Number(b.retrasado) - Number(a.retrasado) ||
          b.diasEnCamino - a.diasEnCamino,
      );
    const totalEnvios = items.length;
    const entregados = items.filter((i) => i.entregado).length;
    const devueltos = items.filter((i) => i.devuelto).length;
    const horasTodas = couriers.filter((c) => c.horasPromedioEntrega != null);
    const horasProm = horasTodas.length
      ? r2(
          horasTodas.reduce(
            (s, c) => s + (c.horasPromedioEntrega ?? 0) * c.entregados,
            0,
          ) /
            Math.max(
              1,
              horasTodas.reduce((s, c) => s + c.entregados, 0),
            ),
        )
      : null;

    return {
      periodo: {
        mes: mesFinal,
        anio: anioFinal,
        fechaInicio: fechaInicio ?? null,
        fechaFin: fechaFin ?? null,
        label,
      },
      resumen: {
        envios: totalEnvios,
        entregados,
        enCurso: enCursoItems.length,
        devueltos,
        retrasados: enCursoItems.filter((i) => i.retrasado).length,
        tasaEntrega: totalEnvios > 0 ? r2((entregados / totalEnvios) * 100) : 0,
        costoEnvioTotal: r2(items.reduce((s, i) => s + i.costoEnvio, 0)),
        ingresoMovido: r2(items.reduce((s, i) => s + i.total, 0)),
        horasPromedioEntrega: horasProm,
        montoCOD: r2(couriers.reduce((s, c) => s + c.montoCOD, 0)),
      },
      couriers,
      serieDiaria,
      destinos,
      enCurso: enCursoItems.slice(0, 200),
      recientes: items.slice(0, 40),
    };
  }

  async getProductosVendidos(
    empresaId: number,
    mes?: number,
    anio?: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number | null,
  ): Promise<ProductosVendidosResponse> {
    const now = new Date();
    const mesFinal = mes && mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1;
    const anioFinal =
      anio && anio >= 2020 && anio <= 2100 ? anio : now.getFullYear();
    const rangoFechas = this.fechasToRange(fechaInicio, fechaFin);
    const range = rangoFechas ?? this.periodoToRange(mesFinal, anioFinal);
    // Un solo día llega como rango de un día (lo manda el filtro "Día"): se
    // etiqueta con la fecha sola, no "2026-09-04 al 2026-09-04", porque este
    // label es el que sale impreso en el PDF del reporte.
    const label = rangoFechas
      ? fechaInicio === fechaFin
        ? String(fechaInicio)
        : `${fechaInicio} al ${fechaFin}`
      : `${this.mesLabel(mesFinal)} ${anioFinal}`;

    const comprobantesRaw = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        fechaEmision: { gte: range.gte, lte: range.lte },
        ...this.filtroExcluirConvertidos,
      },
      select: {
        tipoDoc: true,
        estadoEnvioSunat: true,
        numDocAfectado: true,
        fechaEmision: true,
        tipoMoneda: true,
        tipoCambio: true,
        detalles: {
          select: {
            descripcion: true,
            cantidad: true,
            mtoPrecioUnitario: true,
            mtoValorVenta: true,
            tipAfeIgv: true,
            productoId: true,
            unidadesPorPaquete: true,
            producto: {
              select: {
                codigo: true,
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
    const criterio = await this.criterioIgvEmpresa(empresaId);
    const comprobantes = await this.excluirNotasCreditoDeAnulacion(
      empresaId,
      comprobantesRaw,
    );

    interface AccProducto {
      productoId: number | null;
      codigo: string | null;
      nombre: string;
      categoria: string;
      ingreso: number;
      ventaConIgv: number;
      costo: number;
      unidades: number;
    }
    interface AccDia {
      ingreso: number;
      costo: number;
      unidades: number;
      porProducto: Map<string, number>;
    }

    const prodMap = new Map<string, AccProducto>();
    const diaMap = new Map<string, AccDia>();
    let documentos = 0;

    for (const comp of comprobantes) {
      if (comp.estadoEnvioSunat === 'ANULADO' || comp.tipoDoc === 'COT')
        continue;
      const signo: 1 | -1 = comp.tipoDoc === '07' ? -1 : 1;
      const diaKey = this.fechaLimaKey(comp.fechaEmision ?? undefined);
      if (!diaKey) continue;
      documentos += 1;

      if (!diaMap.has(diaKey)) {
        diaMap.set(diaKey, {
          ingreso: 0,
          costo: 0,
          unidades: 0,
          porProducto: new Map(),
        });
      }
      const dia = diaMap.get(diaKey)!;

      for (const det of comp.detalles) {
        const nombre =
          det.producto?.descripcion ?? det.descripcion ?? 'Producto';
        const prodKey = String(det.productoId ?? `srv:${nombre}`);
        // Paquete vendido como UNA línea (Empresa.paquetesComoUnaLinea): la
        // cantidad facturada (p.ej. 1 caja) se usa para el ingreso (ya viene
        // al precio completo del paquete), pero el costo y las unidades deben
        // reflejar las unidades reales = cantidad × unidadesPorPaquete.
        const uPaquete = Number(det.unidadesPorPaquete) || 1;
        const cantidadFacturada = (det.cantidad ?? 0) * signo;
        const qty = cantidadFacturada * uPaquete;
        const costoUnit =
          this.toNumber(det.producto?.costoPromedio) +
          this.toNumber(det.producto?.costoFijo);
        // Ingreso sin el IGV declarado, igual que las ventas netas del P&L.
        const ingreso =
          montoEnPen(
            this.ingresoLineaSinIgv(comp.tipoDoc, det, criterio),
            comp.tipoMoneda,
            this.toNumber(comp.tipoCambio),
          ) * signo;
        const costo = costoUnit * qty;
        const ventaConIgv =
          montoEnPen(
            this.ventaLineaConIgv(det),
            comp.tipoMoneda,
            this.toNumber(comp.tipoCambio),
          ) * signo;

        if (!prodMap.has(prodKey)) {
          prodMap.set(prodKey, {
            productoId: det.productoId ?? null,
            codigo: det.producto?.codigo ?? null,
            nombre,
            categoria: det.producto?.categoria?.nombre ?? 'Sin categoría',
            ingreso: 0,
            ventaConIgv: 0,
            costo: 0,
            unidades: 0,
          });
        }
        const acc = prodMap.get(prodKey)!;
        acc.ingreso += ingreso;
        acc.ventaConIgv += ventaConIgv;
        acc.costo += costo;
        acc.unidades += qty;

        dia.ingreso += ingreso;
        dia.costo += costo;
        dia.unidades += qty;
        dia.porProducto.set(
          prodKey,
          (dia.porProducto.get(prodKey) ?? 0) + ingreso,
        );
      }
    }

    const ingresoTotal = this.r2(
      [...prodMap.values()].reduce((s, p) => s + p.ingreso, 0),
    );

    const ordenados = [...prodMap.entries()].sort(
      (a, b) => b[1].ingreso - a[1].ingreso,
    );

    const productos: ProductoVendido[] = ordenados.map(([, p]) => {
      const ingresoProd = this.r2(p.ingreso);
      const costoProd = this.r2(p.costo);
      const gananciaTotal = this.r2(p.ingreso - p.costo);
      return {
        productoId: p.productoId,
        codigo: p.codigo,
        nombre: p.nombre,
        categoria: p.categoria,
        unidadesVendidas: this.r2(p.unidades),
        precioPromedio: this.r2(p.unidades !== 0 ? p.ingreso / p.unidades : 0),
        costoUnitario: this.r2(p.unidades !== 0 ? p.costo / p.unidades : 0),
        ingresoTotal: ingresoProd,
        ventasConIgv: this.r2(p.ventaConIgv),
        costoTotal: costoProd,
        gananciaTotal,
        margen: p.ingreso > 0 ? this.r2((gananciaTotal / p.ingreso) * 100) : 0,
        participacion:
          ingresoTotal > 0 ? this.r2((ingresoProd / ingresoTotal) * 100) : 0,
      };
    });

    const topKeys = ordenados.slice(0, 5).map(([key]) => key);
    const topNombres = ordenados.slice(0, 5).map(([, p]) => p.nombre);

    const serieDiaria: ProductosVendidosDia[] = this.diasDelRango(
      range,
      diaMap,
    ).map((fecha) => {
      const dia = diaMap.get(fecha);
      const porProducto: Record<string, number> = {};
      topKeys.forEach((key, i) => {
        porProducto[topNombres[i]] = this.r2(dia?.porProducto.get(key) ?? 0);
      });
      return {
        fecha,
        unidades: this.r2(dia?.unidades ?? 0),
        ingreso: this.r2(dia?.ingreso ?? 0),
        costo: this.r2(dia?.costo ?? 0),
        ganancia: this.r2((dia?.ingreso ?? 0) - (dia?.costo ?? 0)),
        productos: porProducto,
      };
    });

    const costoTotal = this.r2(productos.reduce((s, p) => s + p.costoTotal, 0));
    const gananciaTotal = this.r2(ingresoTotal - costoTotal);

    return {
      periodo: {
        mes: mesFinal,
        anio: anioFinal,
        fechaInicio: rangoFechas ? (fechaInicio ?? null) : null,
        fechaFin: rangoFechas ? (fechaFin ?? null) : null,
        label,
      },
      resumen: {
        ingresoTotal,
        ventasConIgv: this.r2(
          productos.reduce((s, p) => s + p.ventasConIgv, 0),
        ),
        costoTotal,
        gananciaTotal,
        margenPromedio:
          ingresoTotal > 0 ? this.r2((gananciaTotal / ingresoTotal) * 100) : 0,
        unidadesVendidas: this.r2(
          productos.reduce((s, p) => s + p.unidadesVendidas, 0),
        ),
        totalProductos: productos.length,
        documentos,
        mejorProducto: productos[0]?.nombre ?? null,
      },
      productos,
      topProductos: topNombres,
      serieDiaria,
    };
  }

  /**
   * Días (YYYY-MM-DD, hora Lima) que cubre el rango, para que el acumulado no
   * tenga huecos. Si el rango es enorme (> 370 días) solo devuelve los días con
   * movimiento, para no inflar la respuesta.
   */
  private diasDelRango(
    range: { gte: Date; lte: Date },
    diaMap: Map<string, unknown>,
  ): string[] {
    const MS_DIA = 24 * 60 * 60 * 1000;
    const totalDias =
      Math.floor((range.lte.getTime() - range.gte.getTime()) / MS_DIA) + 1;
    if (totalDias > 370 || totalDias < 1) {
      return [...diaMap.keys()].sort();
    }
    const finKey = this.fechaLimaKey(range.lte)!;
    const dias: string[] = [];
    let cursor = range.gte.getTime();
    for (let i = 0; i < totalDias + 1; i++) {
      const key = this.fechaLimaKey(new Date(cursor))!;
      dias.push(key);
      if (key >= finKey) break;
      cursor += MS_DIA;
    }
    return dias;
  }

  async getMetodosPago(
    empresaId: number,
    mes?: number,
    anio?: number,
    fechaInicio?: string,
    fechaFin?: string,
    sedeId?: number | null,
  ) {
    const now = new Date();
    const mesFinal = mes && mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1;
    const anioFinal =
      anio && anio >= 2020 && anio <= 2100 ? anio : now.getFullYear();
    const range =
      this.fechasToRange(fechaInicio, fechaFin) ??
      this.periodoToRange(mesFinal, anioFinal);
    // Un solo día llega como rango de un día (lo manda el filtro "Día"): se
    // etiqueta con la fecha sola, no "2026-09-04 al 2026-09-04", porque este
    // label es el que sale impreso en el PDF del reporte.
    const periodoLabel =
      fechaInicio && fechaFin
        ? fechaInicio === fechaFin
          ? fechaInicio
          : `${fechaInicio} al ${fechaFin}`
        : `${this.mesLabel(mesFinal)} ${anioFinal}`;

    const pagos = await this.prisma.pago.findMany({
      where: {
        empresaId,
        fecha: { gte: range.gte, lte: range.lte },
        comprobante: {
          estadoEnvioSunat: { not: EstadoSunat.ANULADO },
          ...this.filtroExcluirConvertidos,
          // Pago no tiene sedeId propio: la sede es la del comprobante que cobra.
          ...(sedeId ? { sedeId } : {}),
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

    const metodoMap = new Map<
      string,
      {
        metodo: string;
        total: number;
        cantidad: number;
        referencias: number;
        cuentas: Set<string>;
        items: any[];
      }
    >();

    const cuentaLabel = (
      cuenta?: {
        banco?: string | null;
        alias?: string | null;
        numeroCuenta?: string | null;
      } | null,
    ) => {
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
      const split = Array.isArray(details?.splitPayments)
        ? details.splitPayments
        : null;
      const legacyLines =
        split && split.length > 0
          ? split.map((line: any) => ({
              metodo: line.method || comp.medioPago || 'EFECTIVO',
              monto: Number(line.amount || 0),
              referencia: line.referencia || null,
              cuenta: line.cuentaBancariaLabel || null,
            }))
          : [
              {
                metodo: comp.medioPago || details?.method || 'EFECTIVO',
                monto: Number(comp.mtoImpVenta || 0),
                referencia: details?.referencia || null,
                cuenta: details?.cuentaBancariaLabel || null,
              },
            ];

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
        items: metodo.items.sort((a, b) =>
          String(b.fecha).localeCompare(String(a.fecha)),
        ),
      }))
      .sort((a, b) => b.total - a.total);

    const totalCobrado = this.r2(
      metodos.reduce((sum, metodo) => sum + metodo.total, 0),
    );
    const totalReferenciado = metodos.reduce(
      (sum, metodo) => sum + metodo.referencias,
      0,
    );
    const totalItems = metodos.reduce(
      (sum, metodo) => sum + metodo.cantidad,
      0,
    );

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
        moneda: dto.moneda ?? 'PEN',
        tipoCambio: dto.moneda === 'USD' ? (dto.tipoCambio ?? null) : null,
        // null = gasto de toda la empresa (no se carga a ninguna sede).
        sedeId: dto.sedeId ?? null,
        cuentaBancariaId: dto.cuentaBancariaId ?? null,
        medioPago: dto.medioPago ?? null,
        proveedor: dto.proveedor ?? null,
        numeroDocumento: dto.numeroDocumento ?? null,
        // El N° de operación solo aplica cuando el pago es con cuenta de banco.
        numeroOperacion: dto.cuentaBancariaId
          ? (dto.numeroOperacion ?? null)
          : null,
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
        // `sedeId: null` explícito = pasa a ser gasto de toda la empresa.
        ...(dto.sedeId !== undefined && { sedeId: dto.sedeId ?? null }),
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
        ...(dto.moneda !== undefined && {
          moneda: dto.moneda,
          // Al cambiar a PEN se limpia el TC; en USD se toma el enviado (o el existente).
          tipoCambio:
            dto.moneda === 'USD'
              ? (dto.tipoCambio ?? existing.tipoCambio ?? null)
              : null,
        }),
        ...(dto.moneda === undefined &&
          dto.tipoCambio !== undefined && { tipoCambio: dto.tipoCambio }),
        ...(dto.cuentaBancariaId !== undefined && {
          cuentaBancariaId: dto.cuentaBancariaId,
        }),
        ...(dto.medioPago !== undefined && { medioPago: dto.medioPago }),
        ...(dto.proveedor !== undefined && { proveedor: dto.proveedor }),
        ...(dto.numeroDocumento !== undefined && {
          numeroDocumento: dto.numeroDocumento,
        }),
        ...(dto.numeroOperacion !== undefined && {
          numeroOperacion: dto.numeroOperacion,
        }),
        // Si se quita la cuenta de banco, el N° de operación pierde sentido.
        ...(dto.cuentaBancariaId !== undefined &&
          !dto.cuentaBancariaId && { numeroOperacion: null }),
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
