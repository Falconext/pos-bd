import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KardexService } from '../kardex/kardex.service';
import { CrearCompraDto } from './dto/crear-compra.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ComprasService {
    constructor(
        private prisma: PrismaService,
        private kardexService: KardexService,
    ) { }

    async crear(empresaId: number, usuarioId: number, data: CrearCompraDto) {
        let subtotal = 0;

        // Obtener sede principal para kardex
        const sedePrincipal = await this.prisma.sede.findFirst({
            where: { empresaId, esPrincipal: true }
        });
        const sedeId = sedePrincipal?.id || 1; // Fallback unsafe but necessary to prevent crash if no sede

        // Prepare detail data and calculate totals from items to be safe
        const detallesData: any[] = [];

        for (const item of data.detalles) {
            const sub = Number(item.cantidad) * Number(item.precioUnitario);
            const igvItem = sub * 0.18; // Default IGV calculation

            subtotal += sub;

            detallesData.push({
                productoId: item.productoId,
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                precioUnitario: item.precioUnitario,
                subtotal: sub,
                igv: igvItem,
                total: sub + igvItem,
                lote: item.lote,
                fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : null,
            });
        }

        // Calculate final totals
        const igvTotal = data.igv !== undefined ? Number(data.igv) : subtotal * 0.18;
        const total = subtotal + igvTotal;

        // Create Purchase Transaction
        const compra = await this.prisma.$transaction(async (tx) => {
            return await tx.compra.create({
                data: {
                    empresaId,
                    proveedorId: data.proveedorId,
                    usuarioId,
                    tipoDoc: data.tipoDoc || 'FACTURA',
                    serie: data.serie,
                    numero: data.numero,
                    fechaEmision: new Date(data.fechaEmision),
                    fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
                    moneda: data.moneda || 'PEN',
                    tipoCambio: data.tipoCambio,
                    subtotal,
                    igv: igvTotal,
                    total,
                    saldo: total - (Number(data.montoPagadoInicial) || 0),
                    estado: 'REGISTRADO',
                    estadoPago: (Number(data.montoPagadoInicial) || 0) >= total ? 'COMPLETADO' : (data.montoPagadoInicial || 0) > 0 ? 'PAGO_PARCIAL' : 'PENDIENTE_PAGO',
                    observaciones: data.observaciones,
                    // Save installments
                    cuotas: data.cuotas ? JSON.stringify(data.cuotas) : undefined,
                    detalles: {
                        create: detallesData
                    },
                    pagos: data.montoPagadoInicial ? {
                        create: {
                            empresaId,
                            usuarioId,
                            monto: data.montoPagadoInicial,
                            metodoPago: data.metodoPagoInicial || 'EFECTIVO',
                            fecha: new Date(),
                        }
                    } : undefined
                }
            });
        });

        // Update Inventory (Kardex)
        // We do this outside the transaction because KardexService manages its own logic.
        // In a production system, we might want to wrap this in the transaction or use a saga.
        for (const item of data.detalles) {
            if (item.productoId) {
                try {
                    await this.kardexService.registrarMovimiento({
                        empresaId,
                        productoId: item.productoId,
                        tipoMovimiento: 'INGRESO',
                        concepto: `COMPRA ${compra.serie}-${compra.numero}`,
                        cantidad: Number(item.cantidad),
                        costoUnitario: Number(item.precioUnitario),
                        compraId: compra.id,
                        usuarioId,
                        sedeId,
                        lote: item.lote,
                        fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : undefined
                    });
                } catch (error) {
                    console.error(`Error updating kardex for product ${item.productoId}:`, error);
                    // Continue with other items, or flag warning?
                }
            }
        }

        return compra;
    }

    async listar(empresaId: number, query: any) {
        const { page = 1, limit = 10, search, estadoPago, fechaInicio, fechaFin } = query;
        const skip = (Number(page) - 1) * Number(limit);

        const where: Prisma.CompraWhereInput = {
            empresaId,
            ...(estadoPago ? { estadoPago: estadoPago } : {}),
            ...(fechaInicio ? {
                fechaEmision: {
                    gte: new Date(fechaInicio),
                    ...(fechaFin ? { lte: new Date(fechaFin + 'T23:59:59') } : {})
                }
            } : {}),
            ...(search ? {
                OR: [
                    { serie: { contains: search, mode: 'insensitive' } },
                    { numero: { contains: search, mode: 'insensitive' } },
                    { proveedor: { nombre: { contains: search, mode: 'insensitive' } } }
                ]
            } : {})
        };

        const [data, total] = await Promise.all([
            this.prisma.compra.findMany({
                where,
                skip,
                take: Number(limit),
                include: { proveedor: true },
                orderBy: { fechaEmision: 'desc' }
            }),
            this.prisma.compra.count({ where })
        ]);

        return { data, total, page: Number(page), limit: Number(limit) };
    }

    async obtenerPorId(empresaId: number, id: number) {
        const compra = await this.prisma.compra.findFirst({
            where: { id, empresaId },
            include: {
                proveedor: true,
                detalles: {
                    include: {
                        producto: true
                    }
                },
                pagos: true,
                usuario: true
            }
        });

        if (!compra) throw new NotFoundException('Compra no encontrada');
        return compra;
    }

    async registrarPago(empresaId: number, usuarioId: number, compraId: number, data: any) {
        const compra = await this.prisma.compra.findFirst({
            where: { id: compraId, empresaId }
        });

        if (!compra) throw new NotFoundException('Compra no encontrada');

        const monto = Number(data.monto);
        if (monto <= 0) throw new BadRequestException('El monto debe ser mayor a 0');
        if (monto > Number(compra.saldo) + 0.1) throw new BadRequestException('El monto excede el saldo pendiente');

        const nuevoSaldo = Number(compra.saldo) - monto;
        const nuevoEstadoPago = nuevoSaldo <= 0.1 ? 'COMPLETADO' : 'PAGO_PARCIAL';

        // Transaction
        const result = await this.prisma.$transaction(async (tx) => {
            // Create Pago
            const pago = await tx.pagoCompra.create({
                data: {
                    empresaId,
                    usuarioId,
                    compraId,
                    monto,
                    metodoPago: data.medioPago || 'EFECTIVO', // Frontend sends 'medioPago', backend uses 'metodoPago'
                    referencia: data.referencia
                }
            });

            // Update Compra
            const compraUpdated = await tx.compra.update({
                where: { id: compraId },
                data: {
                    saldo: nuevoSaldo,
                    estadoPago: nuevoEstadoPago
                }
            });

            return { pago, nuevoSaldo: Number(compraUpdated.saldo), nuevoEstado: compraUpdated.estadoPago };
        });

        return { success: true, ...result };
    }

    async getHistorialPagos(empresaId: number, compraId: number) {
        const pagos = await this.prisma.pagoCompra.findMany({
            where: { compraId, empresaId },
            orderBy: { fecha: 'desc' }
        });

        const totalPagado = pagos.reduce((acc, curr) => acc + Number(curr.monto), 0);

        return { success: true, data: pagos, totalPagado };
    }
}
