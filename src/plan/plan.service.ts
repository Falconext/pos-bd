import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

const PLAN_INCLUDE = {
    _count: { select: { empresas: true } },
    modulosAsignados: {
        include: {
            modulo: {
                include: { subModulos: { where: { activo: true }, orderBy: { orden: 'asc' as const } } }
            }
        },
        orderBy: { modulo: { orden: 'asc' as const } },
    },
    subModulosAsignados: {
        include: {
            subModulo: { select: { id: true, codigo: true, nombre: true, moduloId: true } }
        }
    },
} as const;

@Injectable()
export class PlanService {
    constructor(private prisma: PrismaService) { }

    private normalizeProducto(value?: string | null): 'facturacion' | 'hotel' {
        return String(value ?? '').trim().toLowerCase() === 'hotel' ? 'hotel' : 'facturacion';
    }

    private async validateProductAssignments(
        producto: 'facturacion' | 'hotel',
        moduloIds?: number[],
        subModuloIds?: number[],
    ) {
        const moduloIdsUnicos = moduloIds ? Array.from(new Set(moduloIds)) : [];
        const subModuloIdsUnicos = subModuloIds ? Array.from(new Set(subModuloIds)) : [];

        if (moduloIdsUnicos.length > 0) {
            const modulos = await this.prisma.modulo.findMany({
                where: { id: { in: moduloIdsUnicos } },
                select: { id: true, producto: true },
            });
            if (modulos.length !== moduloIdsUnicos.length) {
                throw new BadRequestException('Uno o más módulos no existen');
            }
            const invalid = modulos.find((modulo) => this.normalizeProducto(modulo.producto) !== producto);
            if (invalid) {
                throw new BadRequestException('No puedes asignar módulos de otro producto al plan');
            }
        }

        if (subModuloIdsUnicos.length > 0) {
            const subModulos = await this.prisma.subModulo.findMany({
                where: { id: { in: subModuloIdsUnicos } },
                select: { id: true, moduloId: true, modulo: { select: { producto: true } } },
            });
            if (subModulos.length !== subModuloIdsUnicos.length) {
                throw new BadRequestException('Uno o más submódulos no existen');
            }

            const invalid = subModulos.find(
                (subModulo) => this.normalizeProducto(subModulo.modulo.producto) !== producto,
            );
            if (invalid) {
                throw new BadRequestException('No puedes asignar submódulos de otro producto al plan');
            }

            if (moduloIdsUnicos.length > 0) {
                const moduloSet = new Set(moduloIdsUnicos);
                const outOfScope = subModulos.find((subModulo) => !moduloSet.has(subModulo.moduloId));
                if (outOfScope) {
                    throw new BadRequestException('Todos los submódulos deben pertenecer a módulos seleccionados');
                }
            }
        }
    }

    async create(dto: CreatePlanDto) {
        const { moduloIds, subModuloIds, ...planData } = dto;
        const producto = this.normalizeProducto(dto.producto);

        await this.validateProductAssignments(producto, moduloIds, subModuloIds);

        return this.prisma.plan.create({
            data: {
                ...planData,
                producto,
                modulosAsignados: moduloIds?.length
                    ? { create: moduloIds.map(moduloId => ({ moduloId })) }
                    : undefined,
                subModulosAsignados: subModuloIds?.length
                    ? { create: subModuloIds.map(subModuloId => ({ subModuloId })) }
                    : undefined,
            },
            include: PLAN_INCLUDE,
        });
    }

    async findAll(producto?: string) {
        const productoFiltro = producto ? this.normalizeProducto(producto) : undefined;
        return this.prisma.plan.findMany({
            where: productoFiltro ? { producto: productoFiltro } : undefined,
            orderBy: { costo: 'asc' },
            include: PLAN_INCLUDE,
        });
    }

    async findOne(id: number) {
        const plan = await this.prisma.plan.findUnique({
            where: { id },
            include: PLAN_INCLUDE,
        });
        if (!plan) throw new NotFoundException(`Plan con ID ${id} no encontrado`);
        return plan;
    }

    async update(id: number, dto: UpdatePlanDto) {
        const currentPlan = await this.prisma.plan.findUniqueOrThrow({
            where: { id },
            select: { id: true, producto: true },
        });

        const { moduloIds, subModuloIds, ...planData } = dto;
        const producto = dto.producto !== undefined
            ? this.normalizeProducto(dto.producto)
            : this.normalizeProducto(currentPlan.producto);

        await this.validateProductAssignments(producto, moduloIds, subModuloIds);

        return this.prisma.$transaction(async (prisma) => {
            if (moduloIds !== undefined) {
                await prisma.planModulo.deleteMany({ where: { planId: id } });
                if (moduloIds.length > 0) {
                    await prisma.planModulo.createMany({
                        data: moduloIds.map(moduloId => ({ planId: id, moduloId })),
                    });
                }
            }

            if (subModuloIds !== undefined) {
                await prisma.planSubModulo.deleteMany({ where: { planId: id } });
                if (subModuloIds.length > 0) {
                    await prisma.planSubModulo.createMany({
                        data: subModuloIds.map(subModuloId => ({ planId: id, subModuloId })),
                    });
                }
            }

            return prisma.plan.update({
                where: { id },
                data: {
                    ...planData,
                    producto,
                },
                include: PLAN_INCLUDE,
            });
        });
    }

    async remove(id: number) {
        await this.findOne(id);
        const count = await this.prisma.empresa.count({ where: { planId: id } });
        if (count > 0) {
            throw new Error(`No se puede eliminar el plan porque tiene ${count} empresas asignadas.`);
        }
        return this.prisma.plan.delete({ where: { id } });
    }
}
