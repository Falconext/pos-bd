import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductoLoteService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Obtener lotes disponibles de un producto (ordenados por vencimiento FEFO)
     * FEFO = First Expire, First Out
     */
    async obtenerLotesDisponibles(productoId: number, empresaId: number) {
        // Verificar que el producto pertenece a la empresa
        const producto = await this.prisma.producto.findFirst({
            where: { id: productoId, empresaId },
        });

        if (!producto) {
            throw new NotFoundException('Producto no encontrado');
        }

        return this.prisma.productoLote.findMany({
            where: {
                productoId,
                activo: true,
                stockActual: { gt: 0 },
            },
            orderBy: { fechaVencimiento: 'asc' }, // FEFO
            include: {
                producto: {
                    select: {
                        descripcion: true,
                        codigo: true,
                    },
                },
            },
        });
    }

    /**
     * Crear nuevo lote al ingresar mercadería
     */
    async crearLote(data: {
        productoId: number;
        empresaId: number;
        lote: string;
        fechaVencimiento: Date;
        stockInicial: number;
        usuarioId: number;
        costoUnitario?: number;
        proveedor?: string;
    }) {
        // Verificar que el producto pertenece a la empresa
        const producto = await this.prisma.producto.findFirst({
            where: { id: data.productoId, empresaId: data.empresaId },
        });

        if (!producto) {
            throw new NotFoundException('Producto no encontrado');
        }

        // Verificar duplicados
        const loteExistente = await this.prisma.productoLote.findUnique({
            where: {
                productoId_lote: {
                    productoId: data.productoId,
                    lote: data.lote,
                },
            },
        });

        if (loteExistente) {
            throw new BadRequestException(
                `Ya existe un lote con código "${data.lote}" para este producto`,
            );
        }

        return this.prisma.$transaction(async (tx) => {
            // 1. Validar y actualizar Stock Global del Producto
            const productoActualizado = await tx.producto.update({
                where: { id: data.productoId },
                data: { stock: { increment: data.stockInicial } },
            });

            // 2. Crear Lote
            const nuevoLote = await tx.productoLote.create({
                data: {
                    productoId: data.productoId,
                    lote: data.lote,
                    fechaVencimiento: data.fechaVencimiento,
                    stockInicial: data.stockInicial,
                    stockActual: data.stockInicial,
                    costoUnitario: data.costoUnitario,
                    proveedor: data.proveedor,
                    activo: true,
                },
                include: {
                    producto: true,
                },
            });

            // 3. Registrar Movimiento Global (Kardex)
            const movimiento = await tx.movimientoKardex.create({
                data: {
                    productoId: data.productoId,
                    empresaId: data.empresaId,
                    tipoMovimiento: 'INGRESO',
                    concepto: `Apertura Lote: ${data.lote}`,
                    cantidad: data.stockInicial,
                    stockAnterior: productoActualizado.stock - data.stockInicial,
                    stockActual: productoActualizado.stock,
                    costoUnitario: data.costoUnitario || producto.costoPromedio || 0,
                    usuarioId: data.usuarioId,
                    comprobanteId: null,
                    fecha: new Date(),
                },
            });

            // 4. Registrar Movimiento Específico de Lote
            await tx.movimientoKardexLote.create({
                data: {
                    movimientoId: movimiento.id,
                    productoLoteId: nuevoLote.id,
                    cantidad: data.stockInicial,
                    stockAnterior: 0,
                    stockActual: data.stockInicial,
                },
            });

            return nuevoLote;
        });
    }

    /**
     * Descontar stock de un lote específico (para ventas)
     * Automáticamente elige el lote más próximo a vencer si no se especifica
     */
    async descontarStockLote(
        productoId: number,
        cantidad: number,
        movimientoKardexId: number,
        loteId?: number, // Opcional: si no se proporciona, usa FEFO
    ) {
        let cantidadRestante = cantidad;
        const lotesAfectados: any[] = [];

        if (loteId) {
            // Caso 1: Lote específico proporcionado (ej. venta manual seleccionando lote)
            const lote = await this.prisma.productoLote.findUnique({
                where: { id: loteId },
            });

            if (!lote) throw new NotFoundException('Lote no encontrado');
            if (lote.stockActual < cantidad) {
                throw new BadRequestException(
                    `Stock insuficiente en el lote "${lote.lote}". Disponible: ${lote.stockActual}`,
                );
            }

            lotesAfectados.push({ lote, cantidadAdescontar: cantidad });
        } else {
            // Caso 2: FEFO automático (múltiples lotes si es necesario)
            const lotesDisponibles = await this.prisma.productoLote.findMany({
                where: {
                    productoId,
                    activo: true,
                    stockActual: { gt: 0 },
                },
                orderBy: { fechaVencimiento: 'asc' }, // Primero los próximos a vencer
            });

            if (lotesDisponibles.length === 0) {
                // Si no hay lotes, no hacemos nada (quizás no es producto con lotes o es venta sin stock)
                // O lanzamos error? Depende de la regla de negocio.
                // Para evitar bloquear ventas de productos sin lotes configurados, retornamos null o array vacío.
                // Pero si es farmacia, DEBERÍA tener lotes.
                // Asumiremos que si se llama a este método, SE ESPERA que haya lotes.
                // Pero permitamos fallo "suave" si no hay lotes, para no romper ventas antiguas.
                // Mejor: Si no encuentra lotes, no descuenta de lotes (solo stock global ya descontado).
                return [];
            }

            // Verificar stock total disponible en lotes
            const stockTotalLotes = lotesDisponibles.reduce((acc, l) => acc + l.stockActual, 0);
            if (stockTotalLotes < cantidad) {
                // Opción: Bloquear venta o permitir stock negativo global (pero lotes en 0).
                // Regla Farmacia: No vender sin lote.
                throw new BadRequestException(
                    `Stock insuficiente en lotes. Solicitado: ${cantidad}, Disponible en lotes: ${stockTotalLotes}`,
                );
            }

            // Distribuir descuento
            for (const lote of lotesDisponibles) {
                if (cantidadRestante <= 0) break;

                const descuento = Math.min(lote.stockActual, cantidadRestante);
                lotesAfectados.push({ lote, cantidadAdescontar: descuento });
                cantidadRestante -= descuento;
            }
        }

        // Ejecutar transacciones
        const transacciones: any[] = [];
        for (const item of lotesAfectados) {
            // Actualizar Lote
            transacciones.push(
                this.prisma.productoLote.update({
                    where: { id: item.lote.id },
                    data: { stockActual: { decrement: item.cantidadAdescontar } },
                })
            );

            // Registrar Movimiento Lote
            transacciones.push(
                this.prisma.movimientoKardexLote.create({
                    data: {
                        productoLoteId: item.lote.id,
                        movimientoId: movimientoKardexId,
                        cantidad: item.cantidadAdescontar,
                        stockAnterior: item.lote.stockActual,
                        stockActual: item.lote.stockActual - item.cantidadAdescontar,
                    },
                })
            );
        }

        await this.prisma.$transaction(transacciones);

        return lotesAfectados;
    }

    /**
     * Aumentar stock de un lote (para devoluciones o ajustes)
     */
    async aumentarStockLote(
        loteId: number,
        cantidad: number,
        movimientoKardexId: number,
    ) {
        const lote = await this.prisma.productoLote.findUnique({
            where: { id: loteId },
        });

        if (!lote) {
            throw new NotFoundException('Lote no encontrado');
        }

        await this.prisma.$transaction([
            this.prisma.productoLote.update({
                where: { id: loteId },
                data: { stockActual: { increment: cantidad } },
            }),

            this.prisma.movimientoKardexLote.create({
                data: {
                    productoLoteId: loteId,
                    movimientoId: movimientoKardexId,
                    cantidad,
                    stockAnterior: lote.stockActual,
                    stockActual: lote.stockActual + cantidad,
                },
            }),
        ]);
    }

    /**
     * Alertar productos próximos a vencer
     */
    async obtenerProductosPorVencer(
        empresaId: number,
        diasAnticipacion = 30,
    ) {
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() + diasAnticipacion);

        return this.prisma.productoLote.findMany({
            where: {
                producto: { empresaId },
                fechaVencimiento: { lte: fechaLimite },
                stockActual: { gt: 0 },
                activo: true,
            },
            include: {
                producto: {
                    select: {
                        descripcion: true,
                        codigo: true,
                        precioUnitario: true,
                    },
                },
            },
            orderBy: { fechaVencimiento: 'asc' },
        });
    }

    /**
     * Obtener lotes vencidos
     */
    async obtenerLotesVencidos(empresaId: number) {
        const hoy = new Date();

        return this.prisma.productoLote.findMany({
            where: {
                producto: { empresaId },
                fechaVencimiento: { lt: hoy },
                stockActual: { gt: 0 },
                activo: true,
            },
            include: {
                producto: true,
            },
            orderBy: { fechaVencimiento: 'desc' },
        });
    }

    /**
     * Obtener todos los lotes de un producto (con historial)
     */
    async obtenerLotesProducto(productoId: number, empresaId: number) {
        const producto = await this.prisma.producto.findFirst({
            where: { id: productoId, empresaId },
        });

        if (!producto) {
            throw new NotFoundException('Producto no encontrado');
        }

        return this.prisma.productoLote.findMany({
            where: { productoId },
            include: {
                movimientosKardex: {
                    include: {
                        movimiento: {
                            select: {
                                concepto: true,
                                fecha: true,
                                tipoMovimiento: true,
                            },
                        },
                    },
                    orderBy: { id: 'desc' },
                    take: 5, // Últimos 5 movimientos por lote
                },
            },
            orderBy: { fechaVencimiento: 'asc' },
        });
    }

    /**
     * Desactivar lote (no eliminar físicamente)
     */
    async desactivarLote(loteId: number, empresaId: number) {
        const lote = await this.prisma.productoLote.findUnique({
            where: { id: loteId },
            include: { producto: true },
        });

        if (!lote) {
            throw new NotFoundException('Lote no encontrado');
        }

        if (lote.producto.empresaId !== empresaId) {
            throw new BadRequestException('No tienes permisos para este lote');
        }

        return this.prisma.productoLote.update({
            where: { id: loteId },
            data: { activo: false },
        });
    }

    async obtenerTodosLotes(empresaId: number) {
        return this.prisma.productoLote.findMany({
            where: {
                producto: { empresaId },
                activo: true,
                stockActual: { gt: 0 },
            },
            include: {
                producto: true,
            },
            orderBy: { fechaVencimiento: 'asc' },
        });
    }
}
