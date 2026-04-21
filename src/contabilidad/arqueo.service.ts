import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ArqueoService {
  constructor(private readonly prisma: PrismaService) {}

  private parseRangeDates(fechaInicio?: string, fechaFin?: string) {
    if (!fechaInicio || !fechaFin) {
      throw new BadRequestException('fechaInicio y fechaFin son requeridos');
    }
    const inicio = new Date(`${fechaInicio}T00:00:00.000-05:00`);
    const fin = new Date(`${fechaFin}T23:59:59.999-05:00`);
    return { gte: inicio, lte: fin } as const;
  }

  async obtenerArqueoCaja(
    empresaId: number,
    fechaInicio: string,
    fechaFin: string,
    sedeId?: number,
  ) {
    const fechaEmision = this.parseRangeDates(fechaInicio, fechaFin);

    // 1. Obtener comprobantes informales COMPLETADOS (pagados al contado)
    const comprobantesInformalesCompletos =
      await this.prisma.comprobante.findMany({
        where: {
          empresaId,
          ...(sedeId ? { sedeId } : {}),
          tipoDoc: { in: ['TICKET', 'NV', 'RH', 'CP'] },
          fechaEmision,
          estadoEnvioSunat: 'NO_APLICA',
          estadoPago: 'COMPLETADO', // Solo los pagados al contado
        },
        select: {
          id: true,
          tipoDoc: true,
          serie: true,
          correlativo: true,
          fechaEmision: true,
          mtoImpVenta: true,
          medioPago: true,
          estadoPago: true,
          cliente: { select: { nombre: true, nroDoc: true } },
          usuario: { select: { nombre: true, email: true } },
        },
        orderBy: { fechaEmision: 'desc' },
      });

    // 2. Obtener comprobantes formales CON PAGOS AL CONTADO
    const comprobantesFormales = await this.prisma.comprobante.findMany({
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
        tipoDoc: { in: ['01', '03'] }, // Facturas y Boletas
        fechaEmision,
        estadoEnvioSunat: { in: ['EMITIDO', 'REGISTRADO'] as any },
        NOT: { formaPagoTipo: { equals: 'CREDITO', mode: 'insensitive' } as any },
      },
      select: {
        id: true,
        tipoDoc: true,
        serie: true,
        correlativo: true,
        fechaEmision: true,
        mtoImpVenta: true,
        medioPago: true,
        cliente: { select: { nombre: true, nroDoc: true } },
        usuario: { select: { nombre: true, email: true } },
      },
      orderBy: { fechaEmision: 'desc' },
    });

    // 3. Obtener todos los pagos del período (incluyendo pagos parciales de NP/OT)
    const pagos = await this.prisma.pago.findMany({
      where: {
        empresaId,
        ...(sedeId ? { comprobante: { sedeId } } : {}),
        fecha: fechaEmision,
      },
      select: {
        id: true,
        fecha: true,
        monto: true,
        medioPago: true,
        observacion: true,
        referencia: true,
        comprobante: {
          select: {
            tipoDoc: true,
            serie: true,
            correlativo: true,
            cliente: { select: { nombre: true } },
          },
        },
      },
      orderBy: { fecha: 'desc' },
    });

    // 4. Calcular ingresos por medio de pago
    const ingresosPorMedioPago = this.calcularIngresosPorMedioPago(
      comprobantesInformalesCompletos,
      comprobantesFormales,
      pagos,
    );

    // 5. Calcular resumen de arqueo
    const resumenArqueo = this.calcularResumenArqueo(
      comprobantesInformalesCompletos,
      comprobantesFormales,
      pagos,
      ingresosPorMedioPago,
    );

    // 6. Obtener movimientos de caja detallados
    const movimientosCaja = this.obtenerMovimientosCaja(
      comprobantesInformalesCompletos,
      comprobantesFormales,
      pagos,
    );

    return {
      resumen: resumenArqueo,
      ingresosPorMedioPago,
      movimientosCaja,
      comprobantesInformales: comprobantesInformalesCompletos.length,
      comprobantesFormales: comprobantesFormales.length,
      totalPagos: pagos.length,
    };
  }

  private calcularIngresosPorMedioPago(
    comprobantesInformales: any[],
    comprobantesFormales: any[],
    pagos: any[],
  ) {
    const mediosPago = {
      EFECTIVO: 0,
      YAPE: 0,
      PLIN: 0,
      TRANSFERENCIA: 0,
      TARJETA: 0,
    };

    // Sumar comprobantes informales COMPLETADOS (pagados al contado)
    comprobantesInformales.forEach((comp) => {
      const medio = comp.medioPago || 'EFECTIVO';
      const monto = Number(comp.mtoImpVenta || 0);

      if (mediosPago.hasOwnProperty(medio)) {
        mediosPago[medio as keyof typeof mediosPago] += monto;
      } else {
        mediosPago.EFECTIVO += monto;
      }
    });

    // Sumar comprobantes formales de contado
    comprobantesFormales.forEach((comp) => {
      const medio = comp.medioPago || 'EFECTIVO';
      const monto = Number(comp.mtoImpVenta || 0);

      if (mediosPago.hasOwnProperty(medio)) {
        mediosPago[medio as keyof typeof mediosPago] += monto;
      } else {
        mediosPago.EFECTIVO += monto;
      }
    });

    // Sumar SOLO pagos (no duplicar comprobantes ya contados)
    pagos.forEach((pago) => {
      const medio = pago.medioPago || 'EFECTIVO';
      const monto = Number(pago.monto || 0);

      if (mediosPago.hasOwnProperty(medio)) {
        mediosPago[medio as keyof typeof mediosPago] += monto;
      } else {
        mediosPago.EFECTIVO += monto;
      }
    });

    return mediosPago;
  }

  private calcularResumenArqueo(
    comprobantesInformales: any[],
    comprobantesFormales: any[],
    pagos: any[],
    ingresosPorMedioPago: any,
  ) {
    const totalComprobantesInformales = comprobantesInformales.reduce(
      (sum, comp) => sum + Number(comp.mtoImpVenta || 0),
      0,
    );

    const totalComprobantesFormales = comprobantesFormales.reduce(
      (sum, comp) => sum + Number(comp.mtoImpVenta || 0),
      0,
    );

    const totalPagos = pagos.reduce(
      (sum, pago) => sum + Number(pago.monto || 0),
      0,
    );

    // Total = comprobantes de contado + pagos parciales (sin duplicar)
    const totalIngresos =
      totalComprobantesInformales + totalComprobantesFormales + totalPagos;
    const totalEfectivo = ingresosPorMedioPago.EFECTIVO;
    const totalDigital =
      ingresosPorMedioPago.YAPE +
      ingresosPorMedioPago.PLIN +
      ingresosPorMedioPago.TRANSFERENCIA;
    const totalTarjetas = ingresosPorMedioPago.TARJETA;

    return {
      totalIngresos: Number(totalIngresos.toFixed(2)),
      totalEfectivo: Number(totalEfectivo.toFixed(2)),
      totalDigital: Number(totalDigital.toFixed(2)),
      totalTarjetas: Number(totalTarjetas.toFixed(2)),
      totalComprobantes:
        comprobantesInformales.length + comprobantesFormales.length,
      totalPagos: pagos.length,
      fechaInicio: '',
      fechaFin: '',
      // Detalle por medio de pago
      detalleEfectivo: Number(ingresosPorMedioPago.EFECTIVO.toFixed(2)),
      detalleYape: Number(ingresosPorMedioPago.YAPE.toFixed(2)),
      detallePlin: Number(ingresosPorMedioPago.PLIN.toFixed(2)),
      detalleTransferencia: Number(
        ingresosPorMedioPago.TRANSFERENCIA.toFixed(2),
      ),
      detalleTarjeta: Number(ingresosPorMedioPago.TARJETA.toFixed(2)),
    };
  }

  private obtenerMovimientosCaja(
    comprobantesInformales: any[],
    comprobantesFormales: any[],
    pagos: any[],
  ) {
    const movimientos: any[] = [];

    // Agregar comprobantes informales completados como movimientos
    comprobantesInformales.forEach((comp) => {
      movimientos.push({
        tipo: 'VENTA',
        documento: `${comp.tipoDoc}-${comp.serie}-${comp.correlativo}`,
        cliente: comp.cliente?.nombre || 'Sin cliente',
        fecha: comp.fechaEmision,
        monto: Number(comp.mtoImpVenta || 0),
        medioPago: comp.medioPago || 'EFECTIVO',
        concepto: `Venta ${comp.tipoDoc}`,
        estadoPago: comp.estadoPago,
        usuario: comp.usuario?.nombre || 'Sin usuario',
      });
    });

    // Agregar comprobantes formales de contado como movimientos
    comprobantesFormales.forEach((comp) => {
      movimientos.push({
        tipo: 'VENTA',
        documento: `${comp.tipoDoc}-${comp.serie}-${comp.correlativo}`,
        cliente: comp.cliente?.nombre || 'Sin cliente',
        fecha: comp.fechaEmision,
        monto: Number(comp.mtoImpVenta || 0),
        medioPago: comp.medioPago || 'EFECTIVO',
        concepto: `Venta ${comp.tipoDoc === '01' ? 'Factura' : 'Boleta'}`,
        estadoPago: 'COMPLETADO',
        usuario: comp.usuario?.nombre || 'Sin usuario',
      });
    });

    // Agregar pagos como movimientos
    pagos.forEach((pago) => {
      movimientos.push({
        tipo: 'PAGO',
        documento: `${pago.comprobante?.tipoDoc}-${pago.comprobante?.serie}-${pago.comprobante?.correlativo}`,
        cliente: pago.comprobante?.cliente?.nombre || 'Sin cliente',
        fecha: pago.fecha,
        monto: Number(pago.monto || 0),
        medioPago: pago.medioPago || 'EFECTIVO',
        concepto: pago.observacion || `Pago ${pago.comprobante?.tipoDoc}`,
        referencia: pago.referencia,
      });
    });

    // Ordenar por fecha descendente
    return movimientos.sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
    );
  }
}
