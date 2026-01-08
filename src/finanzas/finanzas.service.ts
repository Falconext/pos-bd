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
    ) {
        const rangoFecha = this.parseRange(fechaInicio, fechaFin);

        // 1. Cuentas por Pagar (Compras)
        // Suma de saldos pendientes de todas las compras activas
        const porPagarAgg = await this.prisma.compra.aggregate({
            where: {
                empresaId,
                estado: { not: 'ANULADO' },
                saldo: { gt: 0 },
            },
            _sum: { saldo: true },
        });

        // 2. Cuentas por Cobrar (Ventas)
        // Usar el mismo filtro que la vista de Cuentas por Cobrar: saldo > 0 y NO completado/anulado
        // Esto incluye ventas al contado con pagos parciales y ventas a crédito pendientes
        const porCobrarAgg = await this.prisma.comprobante.aggregate({
            where: {
                empresaId,
                estadoEnvioSunat: { notIn: ['ANULADO'] },
                estadoPago: { notIn: ['COMPLETADO', 'ANULADO'] },
                saldo: { gt: 0 },
            },
            _sum: { saldo: true },
        });

        const totalPorCobrar = Number(porCobrarAgg._sum.saldo || 0);

        // 3. Flujo de Caja (Ingresos vs Egresos) en el rango de fechas
        // VENTAS CONTADO (Ingreso Real)
        const ventasContado = await this.prisma.comprobante.groupBy({
            by: ['fechaEmision'],
            where: {
                empresaId,
                fechaEmision: rangoFecha,
                formaPagoTipo: 'Contado',
                estadoEnvioSunat: { not: 'ANULADO' },
            },
            _sum: { mtoImpVenta: true },
        });

        // COBROS DE CREDITOS (Ingreso Real)
        const cobrosCredito = await this.prisma.pago.groupBy({
            by: ['fecha'],
            where: {
                empresaId,
                fecha: rangoFecha,
            },
            _sum: { monto: true },
        });

        // PAGOS A PROVEEDORES (Egreso Real)
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
}
