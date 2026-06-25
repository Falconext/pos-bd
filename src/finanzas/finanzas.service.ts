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

        // 3. Flujo de Caja (Ingresos vs Egresos) en el rango de fechas.
        // Fuente principal: pagos reales. Respaldo: comprobantes antiguos completados sin pagos.
        const pagosIngreso = await this.prisma.pago.findMany({
            where: {
                empresaId,
                fecha: rangoFecha,
                comprobante: {
                    ...(sedeId ? { sedeId } : {}),
                    estadoEnvioSunat: { not: 'ANULADO' },
                },
            },
            select: {
                fecha: true,
                monto: true,
                medioPago: true,
                referencia: true,
                cuentaBancaria: { select: { banco: true, alias: true, numeroCuenta: true } },
            },
        });

        const ventasContadoSinPago = await this.prisma.comprobante.findMany({
            where: {
                empresaId,
                ...(sedeId ? { sedeId } : {}),
                fechaEmision: rangoFecha,
                formaPagoTipo: { in: ['Contado', 'CONTADO', 'contado'] },
                estadoEnvioSunat: { not: 'ANULADO' },
                estadoPago: 'COMPLETADO',
                pagos: { none: {} },
            },
            select: {
                fechaEmision: true,
                mtoImpVenta: true,
                medioPago: true,
            },
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

        const resumenMetodos = new Map<string, { metodo: string; total: number; cantidad: number; referencias: number }>();
        const sumarMetodo = (metodoRaw: string | null | undefined, monto: number, tieneReferencia = false) => {
            const metodo = String(metodoRaw || 'EFECTIVO').toUpperCase();
            const actual = resumenMetodos.get(metodo) || { metodo, total: 0, cantidad: 0, referencias: 0 };
            actual.total += Number(monto || 0);
            actual.cantidad += 1;
            if (tieneReferencia) actual.referencias += 1;
            resumenMetodos.set(metodo, actual);
        };

        pagosIngreso.forEach((p) => {
            const fecha = p.fecha.toISOString().split('T')[0];
            const actual = mapDatos.get(fecha) || { fecha, ingresos: 0, egresos: 0 };
            actual.ingresos += Number(p.monto || 0);
            mapDatos.set(fecha, actual);
            sumarMetodo(p.medioPago, Number(p.monto || 0), Boolean(p.referencia));
        });

        ventasContadoSinPago.forEach((v) => {
            const fecha = v.fechaEmision.toISOString().split('T')[0];
            const actual = mapDatos.get(fecha) || { fecha, ingresos: 0, egresos: 0 };
            actual.ingresos += Number(v.mtoImpVenta || 0);
            mapDatos.set(fecha, actual);
            sumarMetodo(v.medioPago, Number(v.mtoImpVenta || 0), false);
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
        const metodosPago = Array.from(resumenMetodos.values())
            .map((item) => ({
                ...item,
                total: Number(item.total.toFixed(2)),
                explicacion: this.explicacionMetodoPago(item.metodo),
            }))
            .sort((a, b) => b.total - a.total);

        return {
            kpis: {
                porPagar: Number(porPagarAgg._sum.saldo || 0),
                porCobrar: totalPorCobrar,
                ingresosPeriodo: ingresosMes,
                egresosPeriodo: egresosMes,
                balancePeriodo: balanceMes
            },
            chartData,
            metodosPago,
            conciliacion: {
                fuentePrincipal: 'pagos',
                pagosRegistrados: pagosIngreso.length,
                comprobantesRespaldo: ventasContadoSinPago.length,
                totalPorMetodo: Number(metodosPago.reduce((sum, item) => sum + item.total, 0).toFixed(2)),
            },
        };
    }

    private explicacionMetodoPago(metodo: string) {
        const labels: Record<string, string> = {
            EFECTIVO: 'Dinero físico que debe cuadrar con caja.',
            YAPE: 'Cobros que deben coincidir con el movimiento de Yape.',
            PLIN: 'Cobros que deben coincidir con el movimiento de Plin.',
            TRANSFERENCIA: 'Depósitos bancarios con cuenta destino y operación.',
            TARJETA: 'Voucher/POS o pasarela, pendiente de liquidación bancaria.',
            MIXTO: 'Pago antiguo sin separación; las nuevas ventas mixtas se distribuyen por método.',
        };
        return labels[metodo] || 'Ingreso registrado por método de pago.';
    }

    async getResumenEcommerce(empresaId: number, fechaInicioStr?: string, fechaFinStr?: string, sedeId?: number | null) {
        const hoy = new Date();
        const inicioRango = fechaInicioStr ? new Date(`${fechaInicioStr}T00:00:00`) : new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const finRango = fechaFinStr ? new Date(`${fechaFinStr}T23:59:59.999`) : new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59, 999);

        const comprobanteWhere: any = {
            empresaId,
            estadoEnvioSunat: { not: 'ANULADO' },
            fechaEmision: { gte: inicioRango, lte: finRango },
        };
        if (sedeId) {
            comprobanteWhere.sedeId = sedeId;
        }

        // Detalles de ventas del mes con info de producto
        const detalles = await this.prisma.detalleComprobante.findMany({
            where: {
                comprobante: comprobanteWhere,
            },
            include: {
                producto: { select: { id: true, descripcion: true, costoPromedio: true, costoFijo: true } },
            },
        });

        // Gasto de publicidad real hasta hoy por producto en el rango
        const finReal = hoy < finRango ? hoy : finRango;
        const campanas = await this.prisma.campanaMarketing.findMany({ where: { empresaId } });
        const gastoAdsPorProducto = new Map<number, number>();
        let gastoAdsTotal = 0;
        for (const c of campanas) {
            if (c.estado === 'PAUSADA' || !c.productoId) continue;
            const inicio = c.fechaInicio > inicioRango ? c.fechaInicio : inicioRango;
            if (inicio > finReal) continue;
            const dias = Math.max(0, Math.ceil((finReal.getTime() - inicio.getTime()) / 86400000));
            const gasto = Number(c.presupuestoDiario) * dias;
            gastoAdsPorProducto.set(c.productoId, (gastoAdsPorProducto.get(c.productoId) ?? 0) + gasto);
            gastoAdsTotal += gasto;
        }

        // Comisiones pagadas/pendientes del rango
        const comisionesWhere: any = {
            empresaId,
            comprobante: comprobanteWhere,
        };
        
        const comisionesAgg = await this.prisma.comisionVendedor.aggregate({
            where: comisionesWhere,
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
            fechaInicio: fechaInicioStr, fechaFin: fechaFinStr,
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

    // ─── Ingresos Manuales ────────────────────────────────────────────────────

    async listarIngresos(empresaId: number, fechaInicio?: string, fechaFin?: string, tipo?: string) {
        const rango = this.parseRange(fechaInicio, fechaFin);
        const items = await this.prisma.ingresoManual.findMany({
            where: {
                empresaId,
                fecha: rango,
                ...(tipo && tipo !== 'TODOS' ? { tipo } : {}),
            },
            orderBy: { fecha: 'desc' },
        });
        const total = items.reduce((s, i) => s + Number(i.monto), 0);
        return { items, total };
    }

    async crearIngreso(empresaId: number, body: { concepto: string; tipo: string; monto: number; fecha: string; descripcion?: string }) {
        return this.prisma.ingresoManual.create({
            data: {
                empresaId,
                concepto: body.concepto,
                tipo: body.tipo,
                monto: body.monto,
                fecha: new Date(`${body.fecha}T12:00:00.000-05:00`),
                descripcion: body.descripcion,
            },
        });
    }

    async actualizarIngreso(empresaId: number, id: number, body: Partial<{ concepto: string; tipo: string; monto: number; fecha: string; descripcion: string }>) {
        return this.prisma.ingresoManual.updateMany({
            where: { id, empresaId },
            data: {
                ...(body.concepto !== undefined ? { concepto: body.concepto } : {}),
                ...(body.tipo !== undefined ? { tipo: body.tipo } : {}),
                ...(body.monto !== undefined ? { monto: body.monto } : {}),
                ...(body.fecha !== undefined ? { fecha: new Date(`${body.fecha}T12:00:00.000-05:00`) } : {}),
                ...(body.descripcion !== undefined ? { descripcion: body.descripcion } : {}),
            },
        });
    }

    async eliminarIngreso(empresaId: number, id: number) {
        return this.prisma.ingresoManual.deleteMany({ where: { id, empresaId } });
    }

    // ─── Egresos (GastoOperativo por rango de fecha) ─────────────────────────

    async listarEgresos(empresaId: number, fechaInicio?: string, fechaFin?: string, categoria?: string) {
        const rango = this.parseRange(fechaInicio, fechaFin);
        const items = await this.prisma.gastoOperativo.findMany({
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
                ...(categoria && categoria !== 'TODOS' ? { categoria: categoria as any } : {}),
            },
            orderBy: { fecha: 'desc' },
        });
        const total = items.reduce((s, i) => s + Number(i.monto), 0);
        return { items, total };
    }

    async crearEgreso(empresaId: number, body: { categoria: string; etiqueta?: string; monto: number; fecha: string; descripcion?: string }) {
        const fechaDate = new Date(`${body.fecha}T12:00:00.000-05:00`);
        return this.prisma.gastoOperativo.create({
            data: {
                empresaId,
                mes: fechaDate.getMonth() + 1,
                anio: fechaDate.getFullYear(),
                fecha: fechaDate,
                categoria: body.categoria as any,
                etiqueta: body.etiqueta,
                monto: body.monto,
                descripcion: body.descripcion,
            },
        });
    }

    async actualizarEgreso(empresaId: number, id: number, body: Partial<{ categoria: string; etiqueta: string; monto: number; fecha: string; descripcion: string }>) {
        const extraDate = body.fecha ? { mes: new Date(`${body.fecha}T12:00:00.000-05:00`).getMonth() + 1, anio: new Date(`${body.fecha}T12:00:00.000-05:00`).getFullYear(), fecha: new Date(`${body.fecha}T12:00:00.000-05:00`) } : {};
        return this.prisma.gastoOperativo.updateMany({
            where: { id, empresaId },
            data: {
                ...extraDate,
                ...(body.categoria !== undefined ? { categoria: body.categoria as any } : {}),
                ...(body.etiqueta !== undefined ? { etiqueta: body.etiqueta } : {}),
                ...(body.monto !== undefined ? { monto: body.monto } : {}),
                ...(body.descripcion !== undefined ? { descripcion: body.descripcion } : {}),
            },
        });
    }

    async eliminarEgreso(empresaId: number, id: number) {
        return this.prisma.gastoOperativo.deleteMany({ where: { id, empresaId } });
    }
}
