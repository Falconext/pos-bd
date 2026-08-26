import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { montoEnPen } from '../common/utils/moneda.util';

@Injectable()
export class ContabilidadService {
  constructor(private readonly prisma: PrismaService) {}

  private parseRangeDates(fechaInicio?: string, fechaFin?: string) {
    if (!fechaInicio || !fechaFin) {
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    }
    const inicio = new Date(`${fechaInicio}T00:00:00.000-05:00`);
    const fin = new Date(`${fechaFin}T23:59:59.999-05:00`);
    return { gte: inicio, lte: fin } as const;
  }

  async obtenerReporte(
    empresaId: number,
    fechaInicio: string,
    fechaFin: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRangeDates(fechaInicio, fechaFin);

    const tipoLabels: Record<string, string> = {
      '01': 'FACTURA',
      '03': 'BOLETA',
      '07': 'NOTA DE CREDITO',
      '08': 'NOTA DE DEBITO',
    };

    // Obtener todos los comprobantes emitidos en el rango
    const comprobantesRaw = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        tipoDoc: { in: ['01', '03', '07', '08'] },
        fechaEmision,
      },
      orderBy: { fechaEmision: 'desc' },
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        fechaEmision: true,
        tipoMoneda: true,
        tipoCambio: true,
        formaPagoTipo: true,
        medioPago: true,
        estadoPago: true,
        saldo: true,
        mtoOperGravadas: true,
        mtoOperInafectas: true,
        mtoIGV: true,
        mtoDescuentoGlobal: true,
        mtoImpVenta: true,
        montoDetraccion: true,
        porcentajeDetraccion: true,
        observaciones: true,
        estadoEnvioSunat: true,
        tipDocAfectado: true,
        numDocAfectado: true,
        motivoId: true,
        motivo: { select: { codigo: true, descripcion: true, tipo: true } },
        tipoOperacion: { select: { codigo: true, descripcion: true } },
        cliente: { select: { nombre: true, nroDoc: true } },
        usuario: { select: { nombre: true } },
        sede: { select: { nombre: true } },
      },
    });

    // Filtrar documentos según reglas contables
    const comprobantesFiltrados = await this.filtrarDocumentosParaReporte(
      comprobantesRaw,
      empresaId,
    );

    // Los montos se guardan en la moneda nativa del comprobante (p.ej. USD para
    // una Factura de exportación); se convierten a soles antes de sumar y de
    // mostrar cada fila, o un comprobante en USD infla el reporte como si fuera PEN.
    const aPen = (c: (typeof comprobantesFiltrados)[number], v: any) =>
      montoEnPen(v, c.tipoMoneda, c.tipoCambio);
    const comprobantes = comprobantesFiltrados.map((c) => ({
      ...c,
      mtoOperGravadas: aPen(c, c.mtoOperGravadas),
      mtoOperInafectas: aPen(c, c.mtoOperInafectas),
      mtoIGV: aPen(c, c.mtoIGV),
      mtoDescuentoGlobal: aPen(c, c.mtoDescuentoGlobal),
      mtoImpVenta: aPen(c, c.mtoImpVenta),
    }));

    // Calcular resumen con lógica contable correcta
    const resumen = comprobantes.reduce(
      (acc, comp) => {
        // Factores según tipo de documento:
        // - Facturas/Boletas: Positivo (+1) - generan ingresos
        // - Notas de Crédito: Negativo (-1) - reducen ingresos
        // - Notas de Débito: Positivo (+1) - aumentan ingresos
        let factor = 1;
        if (comp.tipoDoc === '07') {
          // Nota de Crédito
          factor = -1;
        }

        const gravadas = Number(comp.mtoOperGravadas || 0) * factor;
        const inafectas = Number(comp.mtoOperInafectas || 0) * factor;
        const igv = Number(comp.mtoIGV || 0) * factor;
        const descuentos = Number(comp.mtoDescuentoGlobal || 0) * factor;
        const total = Number(comp.mtoImpVenta || 0) * factor;

        return {
          totalVenta: acc.totalVenta + total,
          totalIGV: acc.totalIGV + igv,
          totalGravadas: acc.totalGravadas + gravadas,
          totalInafectas: acc.totalInafectas + inafectas,
          totalDescuentos: acc.totalDescuentos + descuentos,
          totalFacturas:
            comp.tipoDoc === '01'
              ? acc.totalFacturas + total
              : acc.totalFacturas,
          totalBoletas:
            comp.tipoDoc === '03' ? acc.totalBoletas + total : acc.totalBoletas,
          totalNotasCredito:
            comp.tipoDoc === '07'
              ? acc.totalNotasCredito + Math.abs(total)
              : acc.totalNotasCredito,
          totalNotasDebito:
            comp.tipoDoc === '08'
              ? acc.totalNotasDebito + total
              : acc.totalNotasDebito,
        };
      },
      {
        totalVenta: 0,
        totalIGV: 0,
        totalGravadas: 0,
        totalInafectas: 0,
        totalDescuentos: 0,
        totalFacturas: 0,
        totalBoletas: 0,
        totalNotasCredito: 0,
        totalNotasDebito: 0,
      },
    );

    const comprobantesConTipo = comprobantes.map((c) => ({
      ...c,
      comprobante: tipoLabels[c.tipoDoc] || 'DESCONOCIDO',
    }));

    // Documentos excluidos de los totales (anulados y sus notas de crédito):
    // se exponen aparte para que el contador pueda cuadrarlos contra SUNAT
    // sin que alteren el neto (cada par boleta+NC suma 0).
    const idsIncluidos = new Set(comprobantes.map((c) => c.id));
    const anulaciones = comprobantesRaw
      .filter((c) => !idsIncluidos.has(c.id))
      .map((c) => ({
        ...c,
        mtoOperGravadas: aPen(c, c.mtoOperGravadas),
        mtoOperInafectas: aPen(c, c.mtoOperInafectas),
        mtoIGV: aPen(c, c.mtoIGV),
        mtoDescuentoGlobal: aPen(c, c.mtoDescuentoGlobal),
        mtoImpVenta: aPen(c, c.mtoImpVenta),
        comprobante: tipoLabels[c.tipoDoc] || 'DESCONOCIDO',
      }));

    return { comprobantes: comprobantesConTipo, resumen, anulaciones };
  }

  /**
   * Filtra documentos según reglas contables:
   * 1. Excluye documentos ANULADOS
   * 2. Para notas de crédito con motivo anulación (01, 06): excluye TANTO el documento
   *    afectado COMO la propia nota de crédito (se cancelan mutuamente, neto = 0)
   * 3. Mantiene notas de corrección/descuento (02, 03, 04, 05, 07) y sus documentos afectados
   */
  private async filtrarDocumentosParaReporte(
    comprobantesRaw: any[],
    empresaId: number,
  ) {
    const documentosExcluidos = new Set<string>();

    // Paso 1: Identificar documentos que deben excluirse
    for (const comp of comprobantesRaw) {
      // Si es una nota de crédito con motivo de anulación/devolución total
      if (
        comp.tipoDoc === '07' &&
        comp.motivo &&
        ['01', '06'].includes(comp.motivo.codigo)
      ) {
        // Excluir la nota de crédito misma (cancela completamente al afectado)
        const ncKey = `${comp.tipoDoc}-${comp.serie}-${comp.correlativo}`;
        documentosExcluidos.add(ncKey);

        if (comp.numDocAfectado) {
          // Excluir también el documento original afectado
          const docKey = `${comp.tipDocAfectado}-${comp.numDocAfectado}`;
          documentosExcluidos.add(docKey);
        }
      }
    }

    // Paso 2: Filtrar comprobantes
    const comprobantes = comprobantesRaw.filter((comp) => {
      // Excluir documentos con estado ANULADO
      if (comp.estadoEnvioSunat === 'ANULADO') {
        return false;
      }

      // Verificar si este documento está en la lista de exclusión
      const docKey = `${comp.tipoDoc}-${comp.serie}-${comp.correlativo}`;
      if (documentosExcluidos.has(docKey)) {
        return false;
      }

      return true;
    });

    console.log(
      `📊 Reporte contable: ${comprobantesRaw.length} documentos emitidos, ${comprobantes.length} incluidos en reporte`,
    );

    return comprobantes;
  }

  async obtenerReporteInformales(
    empresaId: number,
    fechaInicio: string,
    fechaFin: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRangeDates(fechaInicio, fechaFin);

    const tipoLabels: Record<string, string> = {
      TICKET: 'TICKET',
      NV: 'NOTA DE VENTA',
      RH: 'RECIBO POR HONORARIOS',
      CP: 'COMPROBANTE DE PAGO',
      NP: 'NOTA DE PEDIDO',
      OT: 'ORDEN DE TRABAJO',
    };

    // Obtener comprobantes informales (no van a SUNAT)
    const comprobantes = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        tipoDoc: { in: ['TICKET', 'NV', 'RH', 'CP', 'NP', 'OT'] },
        fechaEmision,
        estadoEnvioSunat: 'NO_APLICA', // Solo informales activos
      },
      orderBy: { fechaEmision: 'desc' },
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        fechaEmision: true,
        mtoImpVenta: true,
        tipoMoneda: true,
        tipoCambio: true,
        estadoPago: true,
        saldo: true,
        medioPago: true,
        estadoOT: true,
        adelanto: true,
        cliente: { select: { nombre: true, nroDoc: true } },
        sede: { select: { nombre: true } },
      },
    });

    // mtoImpVenta se guarda en la moneda nativa del comprobante (p.ej. USD para
    // una Nota de Venta en dólares); se convierte a soles antes de sumar y de
    // mostrar cada fila, o un comprobante en USD infla el reporte como si fuera PEN.
    const comprobantesPen = comprobantes.map((c) => ({
      ...c,
      mtoImpVenta: montoEnPen(c.mtoImpVenta, c.tipoMoneda, c.tipoCambio),
    }));

    // Calcular resumen por tipo de comprobante informal
    const resumen = comprobantesPen.reduce(
      (acc, comp) => {
        const total = Number(comp.mtoImpVenta || 0);

        return {
          totalVenta: acc.totalVenta + total,
          totalTickets:
            comp.tipoDoc === 'TICKET'
              ? acc.totalTickets + total
              : acc.totalTickets,
          totalNotasVenta:
            comp.tipoDoc === 'NV'
              ? acc.totalNotasVenta + total
              : acc.totalNotasVenta,
          totalRecibosHonorarios:
            comp.tipoDoc === 'RH'
              ? acc.totalRecibosHonorarios + total
              : acc.totalRecibosHonorarios,
          totalComprobantesPago:
            comp.tipoDoc === 'CP'
              ? acc.totalComprobantesPago + total
              : acc.totalComprobantesPago,
          totalNotasPedido:
            comp.tipoDoc === 'NP'
              ? acc.totalNotasPedido + total
              : acc.totalNotasPedido,
          totalOrdenesTrabajo:
            comp.tipoDoc === 'OT'
              ? acc.totalOrdenesTrabajo + total
              : acc.totalOrdenesTrabajo,
        };
      },
      {
        totalVenta: 0,
        totalTickets: 0,
        totalNotasVenta: 0,
        totalRecibosHonorarios: 0,
        totalComprobantesPago: 0,
        totalNotasPedido: 0,
        totalOrdenesTrabajo: 0,
      },
    );

    const comprobantesConTipo = comprobantesPen.map((c) => ({
      ...c,
      comprobante: tipoLabels[c.tipoDoc] || 'DESCONOCIDO',
    }));

    return { comprobantes: comprobantesConTipo, resumen };
  }

  /**
   * Reporte de COMPRAS del período (registro de compras / facturas de compra).
   * Fuente: modelo Compra. Excluye ANULADAS. Complementa el reporte de ventas.
   */
  async obtenerReporteCompras(
    empresaId: number,
    fechaInicio: string,
    fechaFin: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRangeDates(fechaInicio, fechaFin);

    const comprasRaw = await this.prisma.compra.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        estado: { not: 'ANULADO' as any },
        fechaEmision,
      },
      orderBy: { fechaEmision: 'desc' },
      include: {
        proveedor: { select: { nombre: true, nroDoc: true } },
        usuario: { select: { nombre: true } },
        sede: { select: { nombre: true } },
      },
    });

    const compras = comprasRaw.map((c) => ({
      id: c.id,
      tipoDoc: c.tipoDoc,
      serie: c.serie,
      numero: c.numero,
      fechaEmision: c.fechaEmision,
      fechaVencimiento: c.fechaVencimiento,
      moneda: c.moneda,
      subtotal: Number(c.subtotal || 0),
      igv: Number(c.igv || 0),
      total: Number(c.total || 0),
      saldo: Number(c.saldo || 0),
      estadoPago: c.estadoPago,
      observaciones: c.observaciones ?? '',
      proveedor: c.proveedor,
      usuario: c.usuario,
      sede: c.sede,
    }));

    const resumen = compras.reduce(
      (acc, c) => ({
        totalCompra: acc.totalCompra + c.total,
        totalGravadas: acc.totalGravadas + c.subtotal,
        totalIGV: acc.totalIGV + c.igv,
        totalSaldo: acc.totalSaldo + c.saldo,
        totalFacturas:
          c.tipoDoc === 'FACTURA' ? acc.totalFacturas + c.total : acc.totalFacturas,
        totalBoletas:
          c.tipoDoc === 'BOLETA' ? acc.totalBoletas + c.total : acc.totalBoletas,
        totalOtros:
          c.tipoDoc !== 'FACTURA' && c.tipoDoc !== 'BOLETA'
            ? acc.totalOtros + c.total
            : acc.totalOtros,
      }),
      {
        totalCompra: 0,
        totalGravadas: 0,
        totalIGV: 0,
        totalSaldo: 0,
        totalFacturas: 0,
        totalBoletas: 0,
        totalOtros: 0,
      },
    );

    return { compras, resumen };
  }

  /**
   * Reporte de GASTOS operativos del período (egresos).
   * Fuente: modelo GastoOperativo. Incluye gastos con fecha en el rango y
   * los recurrentes diarios vigentes (misma lógica que finanzas.listarEgresos).
   * No se filtra por sede porque GastoOperativo no está asociado a una sede.
   */
  async obtenerReporteGastos(
    empresaId: number,
    fechaInicio: string,
    fechaFin: string,
  ) {
    const rango = this.parseRangeDates(fechaInicio, fechaFin);

    const gastosRaw = await this.prisma.gastoOperativo.findMany({
      where: {
        empresaId,
        OR: [
          { fecha: rango },
          {
            recurrenteDiario: true,
            fechaInicio: { lte: rango.lte },
            OR: [{ fechaFin: null }, { fechaFin: { gte: rango.gte } }],
          },
        ],
      },
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    });

    // Un gasto recurrente diario cuenta su `monto` (tarifa diaria) por cada día
    // ACTIVO dentro del rango; los no recurrentes cuentan 1 vez. `montoPeriodo`
    // es el total del período (antes se sumaba `monto` una sola vez, subestimando).
    const hoy = new Date();
    const gastos = gastosRaw.map((g) => {
      const monto = Number(g.monto || 0);
      let dias = 1;
      if (g.recurrenteDiario) {
        const inicioBase =
          g.fechaInicio && g.fechaInicio > rango.gte
            ? g.fechaInicio
            : rango.gte;
        const finClamp =
          g.fechaFin && g.fechaFin < rango.lte ? g.fechaFin : rango.lte;
        const fin = hoy < finClamp ? hoy : finClamp;
        dias =
          fin > inicioBase
            ? Math.ceil((fin.getTime() - inicioBase.getTime()) / 86400000)
            : 0;
      }
      return {
        id: g.id,
        fecha: g.fecha ?? g.fechaInicio ?? g.creadoEn,
        categoria: g.categoria,
        etiqueta: g.etiqueta ?? '',
        descripcion: g.descripcion ?? '',
        recurrenteDiario: g.recurrenteDiario,
        monto,
        dias,
        montoPeriodo: monto * dias,
      };
    });

    const porCategoria: Record<string, number> = {};
    let totalGastos = 0;
    for (const g of gastos) {
      totalGastos += g.montoPeriodo;
      porCategoria[g.categoria] =
        (porCategoria[g.categoria] ?? 0) + g.montoPeriodo;
    }

    const resumen = {
      totalGastos,
      totalPublicidad: porCategoria['PUBLICIDAD'] ?? 0,
      totalSueldos: porCategoria['SUELDOS'] ?? 0,
      totalEnvios: porCategoria['ENVIOS'] ?? 0,
      totalComisiones: porCategoria['COMISIONES'] ?? 0,
      totalAlquiler: porCategoria['ALQUILER'] ?? 0,
      totalOtros:
        (porCategoria['OTROS'] ?? 0) + (porCategoria['PERSONALIZADA'] ?? 0),
    };

    return { gastos, resumen };
  }
}
