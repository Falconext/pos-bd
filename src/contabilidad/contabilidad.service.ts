import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { montoEnPen } from '../common/utils/moneda.util';
import {
  egresosCajaWhere,
  mapCategoriaCaja,
  EGRESO_CAJA_SELECT,
} from '../common/utils/egresos-caja.util';
import { factorCompraASoles, montoCompraEnSoles } from '../common/utils/moneda-compra';

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
        // Exoneradas (Ley de Amazonía) y exportación: sin ellas la fila de una
        // empresa exonerada sale 0/0/0 con el total lleno y no cuadra.
        mtoOperExoneradas: true,
        mtoOperExportacion: true,
        mtoIGV: true,
        mtoDescuentoGlobal: true,
        mtoImpVenta: true,
        montoDetraccion: true,
        porcentajeDetraccion: true,
        // Distingue retención de detracción: comparten columnas y solo la
        // detracción lleva tipo. Sin esto el export las rotula igual.
        tipoDetraccionId: true,
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

    const comprobantesFiltrados =
      this.filtrarDocumentosParaReporte(comprobantesRaw);

    // Los montos se guardan en la moneda nativa del comprobante (p.ej. USD para
    // una Factura de exportación); se convierten a soles antes de sumar y de
    // mostrar cada fila, o un comprobante en USD infla el reporte como si fuera PEN.
    const aPen = (c: (typeof comprobantesFiltrados)[number], v: any) =>
      montoEnPen(v, c.tipoMoneda, c.tipoCambio);
    // `mtoImpVentaDoc` conserva el total en la moneda del documento: la fila
    // se muestra en soles, pero el contador necesita ver el US$ original y el TC.
    const enPen = (c: (typeof comprobantesFiltrados)[number]) => ({
      ...c,
      mtoOperGravadas: aPen(c, c.mtoOperGravadas),
      mtoOperInafectas: aPen(c, c.mtoOperInafectas),
      mtoOperExoneradas: aPen(c, c.mtoOperExoneradas),
      mtoOperExportacion: aPen(c, c.mtoOperExportacion),
      mtoIGV: aPen(c, c.mtoIGV),
      mtoDescuentoGlobal: aPen(c, c.mtoDescuentoGlobal),
      mtoImpVenta: aPen(c, c.mtoImpVenta),
      mtoImpVentaDoc: Number(c.mtoImpVenta || 0),
    });
    const comprobantes = comprobantesFiltrados.map(enPen);

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
        const exoneradas = Number(comp.mtoOperExoneradas || 0) * factor;
        const exportacion = Number(comp.mtoOperExportacion || 0) * factor;
        const igv = Number(comp.mtoIGV || 0) * factor;
        const descuentos = Number(comp.mtoDescuentoGlobal || 0) * factor;
        const total = Number(comp.mtoImpVenta || 0) * factor;

        return {
          totalVenta: acc.totalVenta + total,
          totalIGV: acc.totalIGV + igv,
          totalGravadas: acc.totalGravadas + gravadas,
          totalInafectas: acc.totalInafectas + inafectas,
          totalExoneradas: acc.totalExoneradas + exoneradas,
          totalExportacion: acc.totalExportacion + exportacion,
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
        totalExoneradas: 0,
        totalExportacion: 0,
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

    // Lo emitido que NO entra al total: solo lo que SUNAT no aceptó. Se expone
    // aparte, con motivo, para que quien compare contra la lista de
    // Comprobantes entienda por qué "falta".
    const idsIncluidos = new Set(comprobantes.map((c) => c.id));
    const excluidos = comprobantesRaw
      .filter((c) => !idsIncluidos.has(c.id))
      .map((c) => ({
        ...enPen(c),
        comprobante: tipoLabels[c.tipoDoc] || 'DESCONOCIDO',
        motivoExclusion:
          c.estadoEnvioSunat === 'RECHAZADO'
            ? 'Rechazado por SUNAT'
            : 'Falló el envío a SUNAT',
      }));

    // Anulados que SÍ suman (ver filtrarDocumentosParaReporte): se informan
    // para que "Nota de Crédito" y "Anulados" se lean juntos.
    const anuladosIncluidos = comprobantes.filter(
      (c) => c.estadoEnvioSunat === 'ANULADO' && c.tipoDoc !== '07',
    );

    return {
      comprobantes: comprobantesConTipo,
      resumen: {
        ...resumen,
        cantidadAnulados: anuladosIncluidos.length,
        totalAnulados: anuladosIncluidos.reduce(
          (t, c) => t + Number(c.mtoImpVenta || 0),
          0,
        ),
      },
      excluidos,
    };
  }

  /**
   * Qué entra al reporte. Mismo criterio que el Libro de Ventas (SIRE), que se
   * verificó al céntimo contra la propuesta RVIE de SUNAT (ver sire.service.ts):
   *
   * - Un comprobante suma en su mes de emisión a valor completo, AUNQUE figure
   *   ANULADO: en este sistema `ANULADO` significa que una nota de crédito lo
   *   anuló (no hay comunicación de baja), y SUNAT lo sigue contando. La
   *   reducción la hace la NC, en negativo, en el mes en que ELLA se emitió.
   *   Excluir el par boleta+NC (como se hacía) borraba la venta de enero cuando
   *   la NC salía en febrero, y enero ya estaba declarado.
   * - RECHAZADO y FALLIDO_ENVIO no suman: SUNAT nunca los aceptó.
   * - PENDIENTE sí suma: está en camino y el contador necesita verlo.
   */
  private filtrarDocumentosParaReporte<T extends { estadoEnvioSunat: string }>(
    comprobantesRaw: T[],
  ): T[] {
    return comprobantesRaw.filter(
      (c) => !['RECHAZADO', 'FALLIDO_ENVIO'].includes(c.estadoEnvioSunat),
    );
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
        // Al convertir una NV/OT el origen queda tal cual (NO_APLICA) y el
        // documento nuevo apunta a él. Se trae para no contar la venta dos veces.
        comprobantesDerivados: {
          select: { tipoDoc: true, serie: true, correlativo: true },
          take: 1,
        },
        consolidadoEn: {
          select: { formal: { select: { tipoDoc: true, serie: true, correlativo: true } } },
        },
      },
    });

    // mtoImpVenta se guarda en la moneda nativa del comprobante (p.ej. USD para
    // una Nota de Venta en dólares); se convierte a soles antes de sumar y de
    // mostrar cada fila, o un comprobante en USD infla el reporte como si fuera PEN.
    const todosPen = comprobantes.map(
      ({ comprobantesDerivados, consolidadoEn, ...c }) => {
        const formal = comprobantesDerivados[0] ?? consolidadoEn?.formal ?? null;
        return {
          ...c,
          mtoImpVenta: montoEnPen(c.mtoImpVenta, c.tipoMoneda, c.tipoCambio),
          convertidoA: formal
            ? `${formal.serie}-${String(formal.correlativo).padStart(8, '0')}`
            : null,
        };
      },
    );

    // Un informal ya convertido (NV → Boleta, OT → NV) dejó de ser una venta de
    // esta pestaña: la venta vive en el documento que salió de él. Sumarlo acá
    // duplica contra "Comprobantes SUNAT" (igual que finanzas.service, que
    // excluye el lado formal por el mismo motivo).
    const convertidos = todosPen.filter((c) => c.convertidoA);
    const comprobantesPen = todosPen.filter((c) => !c.convertidoA);

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

    const conTipo = (c: (typeof todosPen)[number]) => ({
      ...c,
      comprobante: tipoLabels[c.tipoDoc] || 'DESCONOCIDO',
    });

    return {
      comprobantes: comprobantesPen.map(conTipo),
      resumen: {
        ...resumen,
        // Se informan aparte para que el contador pueda cuadrar el conteo.
        cantidadConvertidos: convertidos.length,
        totalConvertidos: convertidos.reduce(
          (s, c) => s + Number(c.mtoImpVenta || 0),
          0,
        ),
      },
      convertidos: convertidos.map(conTipo),
    };
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
      tipoCambio: factorCompraASoles(c),
      // Importes en SOLES (una factura en US$ se convierte con su TC), que es
      // lo que suma el reporte; los valores del documento van aparte.
      subtotal: montoCompraEnSoles(c.subtotal, c),
      igv: montoCompraEnSoles(c.igv, c),
      total: montoCompraEnSoles(c.total, c),
      saldo: montoCompraEnSoles(c.saldo, c),
      subtotalDoc: Number(c.subtotal || 0),
      igvDoc: Number(c.igv || 0),
      totalDoc: Number(c.total || 0),
      saldoDoc: Number(c.saldo || 0),
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
   * Fuente: GastoOperativo + los gastos registrados en caja
   * (MovimientoCaja EGRESO), que son plata que salio del negocio igual. Incluye gastos con fecha en el rango y
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
        origen: 'OPERATIVO',
      };
    });

    // Gastos de caja chica: mismas reglas que el resto de los reportes (sin
    // transferencias entre sedes, solo aprobados). Nunca son recurrentes, asi
    // que su montoPeriodo es el monto tal cual.
    const cajaRaw = await this.prisma.movimientoCaja.findMany({
      where: egresosCajaWhere(empresaId, rango.gte, rango.lte),
      select: EGRESO_CAJA_SELECT,
      orderBy: { fecha: 'desc' },
    });
    for (const mov of cajaRaw) {
      const monto = Number(mov.monto || 0);
      gastos.push({
        id: mov.id,
        fecha: mov.fecha,
        categoria: mapCategoriaCaja(mov.categoriaGasto) as any,
        etiqueta: mov.categoriaGasto?.trim()
          ? `Caja - ${mov.categoriaGasto.trim()}`
          : 'Caja chica',
        descripcion: mov.descripcionGasto ?? '',
        recurrenteDiario: false,
        monto,
        dias: 1,
        montoPeriodo: monto,
        origen: 'CAJA',
      });
    }
    gastos.sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
    );

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
