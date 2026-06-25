import { Injectable } from '@nestjs/common';
import { EstadoComision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ComisionesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // HOOK: Registrar comisiones automáticamente al emitir un comprobante
  // Se llama desde comprobante.service.ts después de crear el comprobante.
  // ─────────────────────────────────────────────────────────────────────────────
  async registrarComisionesDesdeComprobante(params: {
    comprobanteId: number;
    empresaId: number;
    vendedorId: number;
    fechaEmision: Date;
    detalles: Array<{
      productoId: number | null;
      descripcion: string;
      cantidad: number;
      mtoPrecioUnitario: number;
    }>;
  }): Promise<void> {
    const { comprobanteId, empresaId, vendedorId, fechaEmision, detalles } = params;

    const vendedor = await this.prisma.usuario.findUnique({
      where: { id: vendedorId },
      select: { comisionGlobal: true, comisionGlobalFija: true, comisionGlobalVenta: true }
    });
    const comisionGlobalPct = Number(vendedor?.comisionGlobal ?? 0);
    const comisionGlobalFija = Number(vendedor?.comisionGlobalFija ?? 0);
    const comisionGlobalVenta = Number(vendedor?.comisionGlobalVenta ?? 0);

    // Obtener la configuración de comisión de cada producto vendido
    const productoIds = detalles
      .map((d) => d.productoId)
      .filter((id): id is number => id !== null);

    if (productoIds.length === 0) return;

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: productoIds }, empresaId },
      select: {
        id: true,
        descripcion: true,
        comisionPorVenta: true,
        comisionPorcentaje: true,
      },
    });

    const productoMap = new Map(productos.map((p) => [p.id, p]));

    const fecha = new Date(fechaEmision);
    const mes = fecha.getMonth() + 1;
    const anio = fecha.getFullYear();

    const comisionesACrear: Array<{
      vendedorId: number;
      comprobanteId: number;
      productoId: number | null;
      empresaId: number;
      mes: number;
      anio: number;
      cantidad: string;
      montoComision: string;
      descripcion: string;
    }> = [];

    for (const detalle of detalles) {
      if (!detalle.productoId) continue;

      const producto = productoMap.get(detalle.productoId);
      if (!producto) continue;

      const comisionFija = Number(producto.comisionPorVenta ?? 0);
      const comisionPct = Number(producto.comisionPorcentaje ?? 0);

      // Calcular monto: primero se usa comisión fija (producto), luego % (producto), luego comisión fija (vendedor), luego % (vendedor)
      let montoComision = 0;
      if (comisionFija > 0) {
        montoComision = comisionFija * detalle.cantidad;
      } else if (comisionPct > 0) {
        montoComision =
          (comisionPct / 100) * detalle.mtoPrecioUnitario * detalle.cantidad;
      } else if (comisionGlobalFija > 0) {
        montoComision = comisionGlobalFija * detalle.cantidad;
      } else if (comisionGlobalPct > 0) {
        montoComision =
          (comisionGlobalPct / 100) * detalle.mtoPrecioUnitario * detalle.cantidad;
      }

      if (montoComision <= 0) continue;

      comisionesACrear.push({
        vendedorId,
        comprobanteId,
        productoId: detalle.productoId,
        empresaId,
        mes,
        anio,
        cantidad: String(detalle.cantidad),
        montoComision: montoComision.toFixed(2),
        descripcion: producto.descripcion,
      });
    }

    // Agregar la comisión por comprobante/venta (si tiene configurada)
    if (comisionGlobalVenta > 0) {
      comisionesACrear.push({
        vendedorId,
        comprobanteId,
        productoId: null, // Representa la venta global
        empresaId,
        mes,
        anio,
        cantidad: "1",
        montoComision: comisionGlobalVenta.toFixed(2),
        descripcion: "Comisión Fija por Venta",
      });
    }

    if (comisionesACrear.length === 0) return;

    await this.prisma.comisionVendedor.createMany({
      data: comisionesACrear,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REPORTE DUEÑO: Lista comisiones de todos los vendedores en un período
  // ─────────────────────────────────────────────────────────────────────────────
  async listarResumenMensual(
    empresaId: number,
    mes: number,
    anio: number,
  ) {
    const comisiones = await this.prisma.comisionVendedor.findMany({
      where: { empresaId, mes, anio },
      include: {
        vendedor: { select: { id: true, nombre: true, rol: true, dni: true } },
        comprobante: {
          select: { id: true, tipoDoc: true, serie: true, correlativo: true, fechaEmision: true },
        },
      },
      orderBy: [{ vendedorId: 'asc' }, { creadoEn: 'desc' }],
    });

    // Agrupar por vendedor
    const vendedorMap = new Map<
      number,
      {
        vendedor: { id: number; nombre: string; rol: string; dni: string };
        totalComision: number;
        totalPagado: number;
        totalPendiente: number;
        cantidadVentas: number;
        comisiones: typeof comisiones;
      }
    >();

    for (const c of comisiones) {
      const v = c.vendedor;
      if (!vendedorMap.has(v.id)) {
        vendedorMap.set(v.id, {
          vendedor: v,
          totalComision: 0,
          totalPagado: 0,
          totalPendiente: 0,
          cantidadVentas: 0,
          comisiones: [],
        });
      }
      const entry = vendedorMap.get(v.id)!;
      const monto = Number(c.montoComision);
      entry.totalComision += monto;
      if (c.estado === 'PAGADO') entry.totalPagado += monto;
      else entry.totalPendiente += monto;
      entry.cantidadVentas += 1;
      entry.comisiones.push(c);
    }

    return {
      mes,
      anio,
      vendedores: [...vendedorMap.values()].map((v) => ({
        ...v,
        totalComision: Math.round(v.totalComision * 100) / 100,
        totalPagado: Math.round(v.totalPagado * 100) / 100,
        totalPendiente: Math.round(v.totalPendiente * 100) / 100,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PANEL VENDEDOR: Ver sus propias comisiones del mes
  // ─────────────────────────────────────────────────────────────────────────────
  async listarComisionesVendedor(
    empresaId: number,
    vendedorId: number,
    mes: number,
    anio: number,
  ) {
    const comisiones = await this.prisma.comisionVendedor.findMany({
      where: { empresaId, vendedorId, mes, anio },
      include: {
        comprobante: {
          select: {
            id: true,
            tipoDoc: true,
            serie: true,
            correlativo: true,
            fechaEmision: true,
            mtoImpVenta: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });

    const totalComision = comisiones.reduce(
      (acc, c) => acc + Number(c.montoComision),
      0,
    );
    const totalPagado = comisiones
      .filter((c) => c.estado === 'PAGADO')
      .reduce((acc, c) => acc + Number(c.montoComision), 0);
    const totalPendiente = totalComision - totalPagado;

    return {
      mes,
      anio,
      totalComision: Math.round(totalComision * 100) / 100,
      totalPagado: Math.round(totalPagado * 100) / 100,
      totalPendiente: Math.round(totalPendiente * 100) / 100,
      comisiones,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DUEÑO: Marcar comisiones como pagadas
  // ─────────────────────────────────────────────────────────────────────────────
  async marcarComisionesPagadas(
    empresaId: number,
    vendedorId: number,
    mes: number,
    anio: number,
  ) {
    const result = await this.prisma.comisionVendedor.updateMany({
      where: {
        empresaId,
        vendedorId,
        mes,
        anio,
        estado: EstadoComision.PENDIENTE,
      },
      data: { estado: EstadoComision.PAGADO },
    });

    return {
      actualizadas: result.count,
      mensaje: `${result.count} comisiones marcadas como PAGADO`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPORT: Datos para Excel (reporte por mes/año)
  // ─────────────────────────────────────────────────────────────────────────────
  async exportarComisionesMes(empresaId: number, mes: number, anio: number) {
    const comisiones = await this.prisma.comisionVendedor.findMany({
      where: { empresaId, mes, anio },
      include: {
        vendedor: { select: { nombre: true, dni: true, rol: true } },
        comprobante: {
          select: {
            tipoDoc: true,
            serie: true,
            correlativo: true,
            fechaEmision: true,
            mtoImpVenta: true,
          },
        },
      },
      orderBy: [{ vendedorId: 'asc' }, { creadoEn: 'asc' }],
    });

    return comisiones.map((c) => ({
      vendedor: c.vendedor.nombre,
      dniVendedor: c.vendedor.dni,
      comprobante: `${c.comprobante.serie}-${String(c.comprobante.correlativo).padStart(8, '0')}`,
      tipoDoc: c.comprobante.tipoDoc,
      fechaVenta: c.comprobante.fechaEmision.toISOString().slice(0, 10),
      totalVenta: Number(c.comprobante.mtoImpVenta),
      producto: c.descripcion,
      productoId: c.productoId,
      cantidad: Number(c.cantidad),
      montoComision: Number(c.montoComision),
      estado: c.estado,
    }));
  }
}
