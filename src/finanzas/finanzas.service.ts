import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FinanzasService {
    constructor(private readonly prisma: PrismaService) { }

    private parseRange(fechaInicio?: string, fechaFin?: string) {
        if (!fechaInicio || !fechaFin) {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return { gte: start, lte: end };
        }
        const start = new Date(`${fechaInicio}T00:00:00.000-05:00`);
        const end = new Date(`${fechaFin}T23:59:59.999-05:00`);
        return { gte: start, lte: end };
    }

    async getResumenFinanciero(
        empresaId: number,
        fechaInicio?: string,
        fechaFin?: string,
        sedeId?: number,
    ) {
        const rangoFecha = this.parseRange(fechaInicio, fechaFin);

        // 1. Cuentas por Pagar (Compras) — filtradas por sede
        const porPagarAgg = await this.prisma.compra.aggregate({
            where: {
                empresaId,
                ...(sedeId ? { sedeId } : {}),
                estado: { not: 'ANULADO' },
                saldo: { gt: 0 },
            },
            _sum: { saldo: true },
        });

        // 2. Cuentas por Cobrar — filtradas por sede
        const porCobrarAgg = await this.prisma.comprobante.aggregate({
            where: {
                empresaId,
                ...(sedeId ? { sedeId } : {}),
                estadoEnvioSunat: { notIn: ['ANULADO'] },
                estadoPago: { notIn: ['COMPLETADO', 'ANULADO'] },
                saldo: { gt: 0 },
            },
            _sum: { saldo: true },
        });

        const totalPorCobrar = Number(porCobrarAgg._sum.saldo || 0);

        // 3. Flujo de Caja (Ingresos vs Egresos) en el rango de fechas
        // VENTAS CONTADO (Ingreso Real) — filtradas por sede
        const ventasContado = await this.prisma.comprobante.groupBy({
            by: ['fechaEmision'],
            where: {
                empresaId,
                ...(sedeId ? { sedeId } : {}),
                fechaEmision: rangoFecha,
                formaPagoTipo: 'Contado',
                estadoEnvioSunat: { not: 'ANULADO' },
            },
            _sum: { mtoImpVenta: true },
        });

        // COBROS DE CREDITOS (Ingreso Real) — filtrados por sede (a través de empresaId)
        const cobrosCredito = await this.prisma.pago.groupBy({
            by: ['fecha'],
            where: {
                empresaId,
                fecha: rangoFecha,
            },
            _sum: { monto: true },
        });

        // PAGOS A PROVEEDORES (Egreso Real) — filtrados por sede
        const pagosCompras = await this.prisma.pagoCompra.groupBy({
            by: ['fecha'],
            where: {
                empresaId,
                fecha: rangoFecha,
            },
            _sum: { monto: true },
        });

        // Mapear datos para el gráfico
        const mapDatos = new Map<string, { fecha: string; ingresos: number; egresos: number }>();

        // Procesar Ingresos (Ventas Contado)
        ventasContado.forEach((v) => {
            const fecha = v.fechaEmision.toISOString().split('T')[0];
            const actual = mapDatos.get(fecha) || { fecha, ingresos: 0, egresos: 0 };
            actual.ingresos += Number(v._sum.mtoImpVenta || 0);
            mapDatos.set(fecha, actual);
        });

        // Procesar Ingresos (Cobros)
        cobrosCredito.forEach((c) => {
            const fecha = c.fecha.toISOString().split('T')[0];
            const actual = mapDatos.get(fecha) || { fecha, ingresos: 0, egresos: 0 };
            actual.ingresos += Number(c._sum.monto || 0);
            mapDatos.set(fecha, actual);
        });

        // Procesar Egresos (Pagos a Proveedores)
        pagosCompras.forEach((p) => {
            const fecha = p.fecha.toISOString().split('T')[0];
            const actual = mapDatos.get(fecha) || { fecha, ingresos: 0, egresos: 0 };
            actual.egresos += Number(p._sum.monto || 0);
            mapDatos.set(fecha, actual);
        });

        const chartData = Array.from(mapDatos.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));

        const ingresosMes = chartData.reduce((acc, curr) => acc + curr.ingresos, 0);
        const egresosMes = chartData.reduce((acc, curr) => acc + curr.egresos, 0);
        const balanceMes = ingresosMes - egresosMes;

        return {
            kpis: {
                porPagar: Number(porPagarAgg._sum.saldo || 0),
                porCobrar: totalPorCobrar,
                ingresosPeriodo: ingresosMes,
                egresosPeriodo: egresosMes,
                balancePeriodo: balanceMes
            },
            chartData
        };
    }

    async getResumenEcommerce(empresaId: number, mes: number, anio: number) {
        const inicioMes = new Date(anio, mes - 1, 1);
        const finMes = new Date(anio, mes, 0, 23, 59, 59);

        // Detalles de ventas del mes con info de producto
        const detalles = await this.prisma.detalleComprobante.findMany({
            where: {
                comprobante: {
                    empresaId,
                    estadoEnvioSunat: { not: 'ANULADO' },
                    fechaEmision: { gte: inicioMes, lte: finMes },
                },
            },
            include: {
                producto: { select: { id: true, descripcion: true, costoPromedio: true, costoFijo: true } },
            },
        });

        // Gasto de publicidad real hasta hoy por producto en el mes
        const hoy = new Date();
        const finReal = hoy < finMes ? hoy : finMes;
        const campanas = await this.prisma.campanaMarketing.findMany({ where: { empresaId } });
        const gastoAdsPorProducto = new Map<number, number>();
        let gastoAdsTotal = 0;
        for (const c of campanas) {
            if (c.estado === 'PAUSADA' || !c.productoId) continue;
            const inicio = c.fechaInicio > inicioMes ? c.fechaInicio : inicioMes;
            if (inicio > finReal) continue;
            const dias = Math.max(0, Math.ceil((finReal.getTime() - inicio.getTime()) / 86400000));
            const gasto = Number(c.presupuestoDiario) * dias;
            gastoAdsPorProducto.set(c.productoId, (gastoAdsPorProducto.get(c.productoId) ?? 0) + gasto);
            gastoAdsTotal += gasto;
        }

        // Comisiones pagadas/pendientes del mes
        const comisionesAgg = await this.prisma.comisionVendedor.aggregate({
            where: { empresaId, mes, anio },
            _sum: { montoComision: true },
        });
        const totalComisiones = Number(comisionesAgg._sum.montoComision ?? 0);

        // Acumular totales y por producto
        const comprobanteIds = new Set<number>();
        let ingresos = 0, costoMercaderia = 0, costoEnvios = 0;

        type ProdEntry = { descripcion: string; unidades: number; ingresos: number; costoMercaderia: number; costoEnvio: number; ads: number };
        const porProducto = new Map<number, ProdEntry>();

        for (const d of detalles) {
            const cant = Number(d.cantidad);
            const ingreso = Number(d.mtoPrecioUnitario) * cant;
            const costo = d.producto ? Number(d.producto.costoPromedio ?? 0) * cant : 0;
            const cf = d.producto ? Number((d.producto as any).costoFijo ?? 0) * cant : 0;

            ingresos += ingreso;
            costoMercaderia += costo;
            costoEnvios += cf;
            comprobanteIds.add(d.comprobanteId);

            if (d.productoId && d.producto) {
                const e = porProducto.get(d.productoId) ?? { descripcion: d.producto.descripcion, unidades: 0, ingresos: 0, costoMercaderia: 0, costoEnvio: 0, ads: 0 };
                e.unidades += cant;
                e.ingresos += ingreso;
                e.costoMercaderia += costo;
                e.costoEnvio += cf;
                porProducto.set(d.productoId, e);
            }
        }

        for (const [prodId, gasto] of gastoAdsPorProducto) {
            const e = porProducto.get(prodId);
            if (e) e.ads = gasto;
        }

        const gananciaReal = ingresos - costoMercaderia - costoEnvios - gastoAdsTotal - totalComisiones;
        const margen = ingresos > 0 ? Math.round((gananciaReal / ingresos) * 100) : 0;

        const productos = Array.from(porProducto.entries())
            .map(([id, p]) => {
                const ganancia = p.ingresos - p.costoMercaderia - p.costoEnvio - p.ads;
                const margenProd = p.ingresos > 0 ? Math.round((ganancia / p.ingresos) * 100) : 0;
                return {
                    id,
                    descripcion: p.descripcion,
                    unidades: Math.round(p.unidades),
                    ingresos: Math.round(p.ingresos * 100) / 100,
                    costoMercaderia: Math.round(p.costoMercaderia * 100) / 100,
                    costoEnvio: Math.round(p.costoEnvio * 100) / 100,
                    ads: Math.round(p.ads * 100) / 100,
                    ganancia: Math.round(ganancia * 100) / 100,
                    margen: margenProd,
                    estado: margenProd >= 20 ? 'bien' : margenProd >= 0 ? 'alerta' : 'perdida' as const,
                };
            })
            .sort((a, b) => b.ingresos - a.ingresos);

        return {
            mes, anio,
            resumen: {
                ingresos: Math.round(ingresos * 100) / 100,
                costoMercaderia: Math.round(costoMercaderia * 100) / 100,
                costoEnvios: Math.round(costoEnvios * 100) / 100,
                gastoPublicidad: Math.round(gastoAdsTotal * 100) / 100,
                comisiones: Math.round(totalComisiones * 100) / 100,
                gananciaReal: Math.round(gananciaReal * 100) / 100,
                margen,
                totalVentas: comprobanteIds.size,
                ticketPromedio: comprobanteIds.size > 0 ? Math.round((ingresos / comprobanteIds.size) * 100) / 100 : 0,
                productosDistintos: porProducto.size,
            },
            productos,
        };
    }
}
