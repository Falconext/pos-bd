import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComboDto, UpdateComboDto } from './dto';

@Injectable()
export class CombosService {
    constructor(private prisma: PrismaService) { }

    async create(empresaId: number, dto: CreateComboDto) {
        // 1. Validar que todos los productos existan y pertenezcan a la empresa
        const productos = await this.prisma.producto.findMany({
            where: {
                id: { in: dto.items.map(i => i.productoId) },
                empresaId,
                estado: 'ACTIVO'
            }
        });

        if (productos.length !== dto.items.length) {
            throw new BadRequestException('Algunos productos no existen o no están activos');
        }

        // 2. Calcular precio regular (suma de precios individuales)
        const precioRegular = dto.items.reduce((sum, item) => {
            const producto = productos.find(p => p.id === item.productoId);
            if (!producto) return sum;
            return sum + (Number(producto.precioUnitario) * item.cantidad);
        }, 0);

        // 3. Validar que el precio del combo sea menor al precio regular
        if (dto.precioCombo >= precioRegular) {
            throw new BadRequestException('El precio del combo debe ser menor al precio regular');
        }

        // 4. Calcular descuento porcentaje
        const descuentoPorcentaje = ((precioRegular - dto.precioCombo) / precioRegular) * 100;

        // 5. Crear combo con items
        return this.prisma.combo.create({
            data: {
                empresaId,
                nombre: dto.nombre,
                descripcion: dto.descripcion,
                imagenUrl: dto.imagenUrl,
                precioRegular,
                precioCombo: dto.precioCombo,
                descuentoPorcentaje,
                activo: dto.activo ?? true,
                fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : null,
                fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
                items: {
                    create: dto.items.map(item => ({
                        productoId: item.productoId,
                        cantidad: item.cantidad
                    }))
                }
            },
            include: {
                items: {
                    include: {
                        producto: {
                            select: {
                                id: true,
                                descripcion: true,
                                imagenUrl: true,
                                precioUnitario: true,
                                stock: true
                            }
                        }
                    }
                }
            }
        });
    }

    async findAll(empresaId: number, includeInactive = false) {
        const where: any = { empresaId };

        if (!includeInactive) {
            where.activo = true;

            // Filtrar por vigencia
            const now = new Date();
            where.OR = [
                { fechaInicio: null },
                { fechaInicio: { lte: now } }
            ];
            where.AND = [
                {
                    OR: [
                        { fechaFin: null },
                        { fechaFin: { gte: now } }
                    ]
                }
            ];
        }

        return this.prisma.combo.findMany({
            where,
            include: {
                items: {
                    include: {
                        producto: {
                            select: {
                                id: true,
                                descripcion: true,
                                imagenUrl: true,
                                precioUnitario: true,
                                stock: true,
                                categoria: {
                                    select: {
                                        id: true,
                                        nombre: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: { creadoEn: 'desc' }
        });
    }

    async findOne(id: number, empresaId: number) {
        const combo = await this.prisma.combo.findFirst({
            where: { id, empresaId },
            include: {
                items: {
                    include: {
                        producto: {
                            select: {
                                id: true,
                                descripcion: true,
                                imagenUrl: true,
                                precioUnitario: true,
                                stock: true,
                                categoria: {
                                    select: {
                                        id: true,
                                        nombre: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!combo) {
            throw new NotFoundException('Combo no encontrado');
        }

        return combo;
    }

    async update(id: number, empresaId: number, dto: UpdateComboDto) {
        // Verificar que el combo existe
        await this.findOne(id, empresaId);

        // Si se actualizan los items, recalcular precios
        let updateData: any = {
            nombre: dto.nombre,
            descripcion: dto.descripcion,
            imagenUrl: dto.imagenUrl,
            activo: dto.activo,
            fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : undefined,
            fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : undefined
        };

        if (dto.items && dto.items.length > 0) {
            // Validar productos
            const productos = await this.prisma.producto.findMany({
                where: {
                    id: { in: dto.items.map(i => i.productoId) },
                    empresaId,
                    estado: 'ACTIVO'
                }
            });

            if (productos.length !== dto.items.length) {
                throw new BadRequestException('Algunos productos no existen o no están activos');
            }

            // Calcular nuevo precio regular
            const precioRegular = dto.items.reduce((sum, item) => {
                const producto = productos.find(p => p.id === item.productoId);
                if (!producto) return sum;
                return sum + (Number(producto.precioUnitario) * item.cantidad);
            }, 0);

            const precioCombo = dto.precioCombo ?? 0;
            const descuentoPorcentaje = precioCombo > 0
                ? ((precioRegular - precioCombo) / precioRegular) * 100
                : 0;

            updateData = {
                ...updateData,
                precioRegular,
                precioCombo,
                descuentoPorcentaje
            };

            // Eliminar items existentes y crear nuevos
            await this.prisma.comboItem.deleteMany({
                where: { comboId: id }
            });

            updateData.items = {
                create: dto.items.map(item => ({
                    productoId: item.productoId,
                    cantidad: item.cantidad
                }))
            };
        } else if (dto.precioCombo) {
            // Solo actualizar precio del combo
            const combo = await this.prisma.combo.findUnique({
                where: { id }
            });

            if (!combo) {
                throw new NotFoundException('Combo no encontrado');
            }

            const precioRegular = Number(combo.precioRegular) || 0;
            const descuentoPorcentaje = precioRegular > 0
                ? ((precioRegular - dto.precioCombo) / precioRegular) * 100
                : 0;
            updateData.precioCombo = dto.precioCombo;
            updateData.descuentoPorcentaje = descuentoPorcentaje;
        }

        return this.prisma.combo.update({
            where: { id },
            data: updateData,
            include: {
                items: {
                    include: {
                        producto: {
                            select: {
                                id: true,
                                descripcion: true,
                                imagenUrl: true,
                                precioUnitario: true,
                                stock: true
                            }
                        }
                    }
                }
            }
        });
    }

    async delete(id: number, empresaId: number) {
        // Verificar que el combo existe
        await this.findOne(id, empresaId);

        return this.prisma.combo.delete({
            where: { id }
        });
    }

    /**
     * Verifica el stock disponible del combo
     * El stock del combo es el mínimo entre todos los productos considerando las cantidades
     */
    async checkStock(comboId: number): Promise<number> {
        const combo = await this.prisma.combo.findUnique({
            where: { id: comboId },
            include: {
                items: {
                    include: { producto: true }
                }
            }
        });

        if (!combo) return 0;

        // El stock del combo es el mínimo entre todos los productos
        const stockDisponible = combo.items.reduce((min, item) => {
            const stockProducto = Math.floor(item.producto.stock / item.cantidad);
            return Math.min(min, stockProducto);
        }, Infinity);

        return stockDisponible === Infinity ? 0 : stockDisponible;
    }

    /**
     * Valida si hay stock suficiente para un combo
     */
    async validateStock(comboId: number, cantidad: number): Promise<boolean> {
        const stockDisponible = await this.checkStock(comboId);
        return stockDisponible >= cantidad;
    }
}
