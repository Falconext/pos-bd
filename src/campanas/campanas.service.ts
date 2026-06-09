import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampanaDto } from './dto/create-campana.dto';
import { UpdateCampanaDto } from './dto/update-campana.dto';
import { EstadoCampana } from '@prisma/client';

@Injectable()
export class CampanasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(empresaId: number, mes: number, anio: number) {
    const campanas = await this.prisma.campanaMarketing.findMany({
      where: { empresaId },
      include: {
        producto: {
          select: {
            id: true,
            descripcion: true,
            precioUnitario: true,
            tipoAfectacionIGV: true,
            costoPromedio: true,
            costoFijo: true,
            comisionPorVenta: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });

    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);

    // Pre-fetch ventas por producto único para evitar doble conteo en el resumen
    const productosActivos = [
      ...new Set(
        campanas
          .filter((c) => c.productoId && c.estado !== EstadoCampana.PAUSADA)
          .map((c) => c.productoId!),
      ),
    ];

    const productSalesMap = new Map<number, number>();
    for (const productoId of productosActivos) {
      const agg = await this.prisma.detalleComprobante.aggregate({
        where: {
          productoId,
          comprobante: {
            empresaId,
            estadoEnvioSunat: { not: 'ANULADO' },
            fechaEmision: { gte: inicioMes, lte: finMes },
          },
        },
        _sum: { cantidad: true },
      });
      productSalesMap.set(productoId, Number(agg._sum.cantidad ?? 0));
    }

    let gastoTotal = 0;

    const hoy = new Date();

    const campanasConMetricas = campanas.map((c) => {
      const inicio = c.fechaInicio > inicioMes ? c.fechaInicio : inicioMes;

      if (inicio > finMes || c.estado === EstadoCampana.PAUSADA) {
        return this.buildCampana(c, 0, 0, 0, 0);
      }

      // Días realmente transcurridos hasta hoy (lo que se ha gastado)
      const finReal = hoy < finMes ? hoy : finMes;
      const diasTranscurridos = Math.max(
        0,
        Math.ceil((finReal.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)),
      );

      // Días proyectados del mes completo (para mostrar duración en la card)
      const diasProyectados = Math.max(
        0,
        Math.ceil((finMes.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)),
      );

      const gastoReal = Math.round(Number(c.presupuestoDiario) * diasTranscurridos * 100) / 100;
      const ventasAtribuidas = c.productoId
        ? (productSalesMap.get(c.productoId) ?? 0)
        : 0;

      gastoTotal += gastoReal;

      return this.buildCampana(c, diasTranscurridos, diasProyectados, gastoReal, ventasAtribuidas);
    });

    // Ventas únicas (sin doble conteo si dos campañas usan el mismo producto)
    const ventasTotal = Array.from(productSalesMap.values()).reduce(
      (a, b) => a + b,
      0,
    );

    // Ingreso basado en productos únicos
    const seenProductos = new Set<number>();
    let ingresoTotal = 0;
    for (const c of campanas) {
      if (
        c.productoId &&
        !seenProductos.has(c.productoId) &&
        c.estado !== EstadoCampana.PAUSADA
      ) {
        const prod = (c as any).producto;
        if (prod) {
          const pConIgv = Number(prod.precioUnitario);
          const esGrav = !['20', '30'].includes(prod.tipoAfectacionIGV ?? '10');
          const pNeto = esGrav ? pConIgv / 1.18 : pConIgv;
          ingresoTotal += pNeto * (productSalesMap.get(c.productoId) ?? 0);
          seenProductos.add(c.productoId);
        }
      }
    }

    return {
      mes,
      anio,
      resumen: {
        gastoTotalEstimado: Math.round(gastoTotal * 100) / 100,
        ventasAtribuidas: ventasTotal,
        cpaPromedio:
          ventasTotal > 0
            ? Math.round((gastoTotal / ventasTotal) * 100) / 100
            : 0,
        roas:
          gastoTotal > 0
            ? Math.round((ingresoTotal / gastoTotal) * 100) / 100
            : 0,
      },
      campanas: campanasConMetricas,
    };
  }

  private buildCampana(c: any, diasTranscurridos: number, diasProyectados: number, gastoReal: number, ventasAtribuidas: number) {
    const cpa = ventasAtribuidas > 0 ? Math.round((gastoReal / ventasAtribuidas) * 100) / 100 : 0;
    const precioConIgv = c.producto ? Number(c.producto.precioUnitario) : 0;
    const tipoAfectacion = c.producto?.tipoAfectacionIGV ?? '10';
    const esGravado = !['20', '30'].includes(tipoAfectacion);
    const precio = esGravado ? Math.round((precioConIgv / 1.18) * 100) / 100 : precioConIgv;
    const costoProducto = c.producto ? Number(c.producto.costoPromedio ?? 0) : 0;
    const costoFijo = c.producto ? Number(c.producto.costoFijo ?? 0) : 0;
    const comisionVenta = c.producto ? Number(c.producto.comisionPorVenta ?? 0) : 0;

    return {
      id: c.id,
      nombre: c.nombre,
      plataforma: c.plataforma,
      producto: c.producto,
      presupuestoDiario: Number(c.presupuestoDiario),
      moneda: c.moneda,
      fechaInicio: c.fechaInicio.toISOString().slice(0, 10),
      estado: c.estado,
      diasActivos: diasTranscurridos,
      diasProyectados,
      gastoEstimado: gastoReal,
      ventasAtribuidas,
      cpa,
      pnlUnidad: c.producto
        ? {
            precio,
            costoProducto,
            costoFijo,
            comisionVenta,
            cpa,
            gananciaReal: Math.round((precio - costoProducto - costoFijo - comisionVenta - cpa) * 100) / 100,
          }
        : null,
    };
  }

  async crear(empresaId: number, dto: CreateCampanaDto) {
    return this.prisma.campanaMarketing.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        plataforma: dto.plataforma,
        productoId: dto.productoId ?? null,
        presupuestoDiario: dto.presupuestoDiario,
        moneda: dto.moneda ?? 'PEN',
        fechaInicio: new Date(`${dto.fechaInicio}T05:00:00.000Z`),
      },
    });
  }

  async actualizar(empresaId: number, id: number, dto: UpdateCampanaDto) {
    await this.verificarPropietario(empresaId, id);
    return this.prisma.campanaMarketing.update({
      where: { id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.plataforma && { plataforma: dto.plataforma }),
        ...('productoId' in dto && { productoId: dto.productoId }),
        ...(dto.presupuestoDiario && { presupuestoDiario: dto.presupuestoDiario }),
        ...(dto.moneda && { moneda: dto.moneda }),
        ...(dto.fechaInicio && { fechaInicio: new Date(`${dto.fechaInicio}T05:00:00.000Z`) }),
        ...(dto.estado && { estado: dto.estado }),
      },
    });
  }

  async eliminar(empresaId: number, id: number) {
    await this.verificarPropietario(empresaId, id);
    return this.prisma.campanaMarketing.delete({ where: { id } });
  }

  private async verificarPropietario(empresaId: number, id: number) {
    const c = await this.prisma.campanaMarketing.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaña no encontrada');
    if (c.empresaId !== empresaId) throw new ForbiddenException();
  }
}
