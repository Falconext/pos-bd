import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) { }

  private parseRange(fechaInicio?: string, fechaFin?: string) {
    const whereFecha: any = {};
    if (fechaInicio)
      whereFecha.gte = new Date(`${fechaInicio}T00:00:00.000-05:00`);
    if (fechaFin) whereFecha.lte = new Date(`${fechaFin}T23:59:59.999-05:00`);
    return Object.keys(whereFecha).length ? whereFecha : undefined;
  }

  async headerResumen(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
  ) {
    const startTime = Date.now();
    try {
      const fechaEmision = this.parseRange(fechaInicio, fechaFin);
      const whereBase: any = {
        empresaId,
        ...(fechaEmision ? { fechaEmision } : {}),
      };

      const [totalIngresosAgg, totalComprobantes, totalClientes, totalProductos] =
        await Promise.all([
          this.prisma.comprobante.aggregate({
            _sum: { mtoImpVenta: true },
            where: whereBase,
          }),
          this.prisma.comprobante.count({ where: whereBase }),
          this.prisma.cliente.count({ where: { empresaId } }),
          // Excluir productos fantasma (DGD, IPM, PLD) y productos inactivos del conteo
          this.prisma.producto.count({
            where: {
              empresaId,
              estado: 'ACTIVO',
              codigo: { notIn: ['DGD', 'IPM', 'PLD'] },
            },
          }),
        ]);

      const elapsed = Date.now() - startTime;
      console.log(`[Dashboard] headerResumen completed in ${elapsed}ms for empresa ${empresaId}`);

      return {
        totalIngresos: Number(totalIngresosAgg._sum.mtoImpVenta ?? 0),
        totalComprobantes,
        totalClientes,
        totalProductos,
      };
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      console.error(`[Dashboard] headerResumen FAILED after ${elapsed}ms for empresa ${empresaId}:`, error.message);
      throw error;
    }
  }

  async ingresosPorComprobante(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    const rows = await this.prisma.comprobante.groupBy({
      by: ['fechaEmision', 'tipoDoc'],
      where: { empresaId, ...(fechaEmision ? { fechaEmision } : {}) },
      _sum: { mtoImpVenta: true },
    });
    const map = new Map<
      string,
      {
        fecha: string;
        facturas: number;
        boletas: number;
        notasCredito: number;
        notasDebito: number;
      }
    >();
    for (const r of rows) {
      const fecha = r.fechaEmision.toISOString().slice(0, 10);
      const item = map.get(fecha) || {
        fecha,
        facturas: 0,
        boletas: 0,
        notasCredito: 0,
        notasDebito: 0,
      };
      const total = Number(r._sum.mtoImpVenta ?? 0);
      if (r.tipoDoc === '01') item.facturas += total;
      else if (r.tipoDoc === '03') item.boletas += total;
      else if (r.tipoDoc === '07') item.notasCredito += total;
      else if (r.tipoDoc === '08') item.notasDebito += total;
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
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    const rows = await this.prisma.comprobante.groupBy({
      by: ['fechaEmision', 'medioPago'],
      where: { empresaId, ...(fechaEmision ? { fechaEmision } : {}) },
      _sum: { mtoImpVenta: true },
    });
    const map = new Map<
      string,
      { fecha: string; YAPE: number; PLIN: number; EFECTIVO: number }
    >();
    for (const r of rows) {
      const fecha = r.fechaEmision.toISOString().slice(0, 10);
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
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    // Prefiltrar comprobantes (IDs) porque groupBy no soporta filtros por relación de forma fiable
    const comprobantes = await this.prisma.comprobante.findMany({
      where: { empresaId, ...(fechaEmision ? { fechaEmision } : {}) },
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

  async clientesNuevos(
    empresaId: number,
    fechaInicio?: string,
    fechaFin?: string,
  ) {
    const fechaEmision = this.parseRange(fechaInicio, fechaFin);
    if (!fechaEmision)
      throw new BadRequestException(
        'Se requiere rango de fechas para clientes nuevos',
      );
    const rows = await this.prisma.comprobante.groupBy({
      by: ['clienteId'],
      where: { empresaId },
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
