import { Injectable, NotFoundException } from '@nestjs/common';
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

    async create(dto: CreatePlanDto) {
        const { moduloIds, subModuloIds, ...planData } = dto;

        return this.prisma.plan.create({
            data: {
                ...planData,
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

    async findAll() {
        return this.prisma.plan.findMany({
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
        await this.prisma.plan.findUniqueOrThrow({ where: { id } });

        const { moduloIds, subModuloIds, ...planData } = dto;

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
                data: planData,
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
