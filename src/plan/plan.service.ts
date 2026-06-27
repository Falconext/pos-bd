import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PLAN_FEATURE_CATALOG, getPlanFeatureKeys } from './plan-feature-catalog';

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
    features: true,
} as const;

@Injectable()
export class PlanService {
    constructor(private prisma: PrismaService) { }

    getFeatureCatalog() {
        return PLAN_FEATURE_CATALOG;
    }

    private resolvePlanFeatures(plan: Record<string, unknown>) {
        const relationFeatures = Array.isArray(plan.features)
            ? (plan.features as Array<{ featureKey: string; enabled: boolean }>)
            : [];
        const relationMap = new Map(relationFeatures.map((feature) => [feature.featureKey, feature.enabled]));

        return getPlanFeatureKeys().reduce<Record<string, boolean>>((features, key) => {
            features[key] = relationMap.has(key) ? Boolean(relationMap.get(key)) : Boolean(plan[key]);
            return features;
        }, {});
    }

    private normalizeFeaturePayload(dto: CreatePlanDto | UpdatePlanDto) {
        const incomingFeatures = dto.features ?? {};
        return getPlanFeatureKeys().reduce<Record<string, boolean>>((features, key) => {
            const directValue = (dto as Record<string, unknown>)[key];
            const mapValue = incomingFeatures[key];
            features[key] = Boolean(mapValue ?? directValue ?? false);
            return features;
        }, {});
    }

    private getPrismaPlanFeatureColumns() {
        return [
            'esPrueba', 'tieneTienda', 'tieneBanners', 'tieneGaleria', 'tieneCulqi',
            'tieneDeliveryGPS', 'tieneTicketera', 'tieneGestionLotes',
            'tieneGestionProvisiones', 'tieneDescripcionRica'
        ];
    }

    private omitVirtualPlanFields<T extends CreatePlanDto | UpdatePlanDto>(dto: T) {
        const { features, moduloIds, subModuloIds, ...planData } = dto;
        const prismaColumns = new Set(this.getPrismaPlanFeatureColumns());
        for (const key of getPlanFeatureKeys()) {
            if (!prismaColumns.has(key)) {
                delete (planData as any)[key];
            }
        }
        return planData;
    }

    private extractSchemaFeatures(features: Record<string, boolean>) {
        const prismaColumns = new Set(this.getPrismaPlanFeatureColumns());
        const result: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(features)) {
            if (prismaColumns.has(key)) {
                result[key] = value;
            }
        }
        return result;
    }

    private withResolvedFeatures<T extends Record<string, unknown>>(plan: T) {
        return {
            ...plan,
            features: this.resolvePlanFeatures(plan),
        };
    }

    private normalizeProducto(value?: string | null): 'facturacion' | 'hotel' {
        return String(value ?? '').trim().toLowerCase() === 'hotel' ? 'hotel' : 'facturacion';
    }

    private normalizePlataforma(value?: string | null): 'falconext' | 'krezka' {
        return String(value ?? '').trim().toLowerCase() === 'krezka' ? 'krezka' : 'falconext';
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
        const { moduloIds, subModuloIds } = dto;
        const planData = this.omitVirtualPlanFields(dto);
        const features = this.normalizeFeaturePayload(dto);
        const producto = this.normalizeProducto(dto.producto);
        const plataforma = this.normalizePlataforma(dto.plataforma);

        await this.validateProductAssignments(producto, moduloIds, subModuloIds);

        try {
            const plan = await this.prisma.plan.create({
                data: {
                    ...planData,
                    ...this.extractSchemaFeatures(features),
                    producto,
                    plataforma,
                    features: {
                        create: Object.entries(features).map(([featureKey, enabled]) => ({ featureKey, enabled })),
                    },
                    modulosAsignados: moduloIds?.length
                        ? { create: moduloIds.map(moduloId => ({ moduloId })) }
                        : undefined,
                    subModulosAsignados: subModuloIds?.length
                        ? { create: subModuloIds.map(subModuloId => ({ subModuloId })) }
                        : undefined,
                },
                include: PLAN_INCLUDE,
            });
            return this.withResolvedFeatures(plan);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new BadRequestException(`Ya existe un plan "${dto.nombre}" para ${plataforma}/${producto}`);
            }
            throw error;
        }
    }

    async findAll(producto?: string, plataforma?: string) {
        const productoFiltro = producto ? this.normalizeProducto(producto) : undefined;
        const plataformaFiltro = plataforma ? this.normalizePlataforma(plataforma) : undefined;
        const plans = await this.prisma.plan.findMany({
            where: {
                ...(productoFiltro
                    ? { producto: { equals: productoFiltro, mode: 'insensitive' } }
                    : {}),
                ...(plataformaFiltro
                    ? { plataforma: { equals: plataformaFiltro, mode: 'insensitive' } }
                    : {}),
            },
            orderBy: { costo: 'asc' },
            include: PLAN_INCLUDE,
        });
        return plans.map((plan) => this.withResolvedFeatures(plan));
    }

    async findPublicPlans(producto?: string, plataforma?: string) {
        const productoFiltro = producto ? this.normalizeProducto(producto) : 'facturacion';
        const plataformaFiltro = plataforma ? this.normalizePlataforma(plataforma) : 'falconext';

        const plans = await this.prisma.plan.findMany({
            where: {
                producto: { equals: productoFiltro, mode: 'insensitive' },
                plataforma: { equals: plataformaFiltro, mode: 'insensitive' },
                esPrueba: false,
            },
            orderBy: { costo: 'asc' },
            select: {
                id: true,
                nombre: true,
                descripcion: true,
                costo: true,
                duracionDias: true,
                maxComprobantes: true,
                limiteUsuarios: true,
                maxSedes: true,
                tieneTienda: true,
                tieneBanners: true,
                tieneGaleria: true,
                tieneCulqi: true,
                tieneDeliveryGPS: true,
                tieneTicketera: true,
                tieneGestionLotes: true,
                tieneGestionProvisiones: true,
                features: true,
            },
        });

        return plans.map((plan) => ({
            ...plan,
            costo: Number(plan.costo),
            maxComprobantes: plan.maxComprobantes ?? null,
            limiteUsuarios: plan.limiteUsuarios ?? null,
            maxSedes: plan.maxSedes ?? null,
            features: this.resolvePlanFeatures(plan),
        }));
    }

    async findOne(id: number) {
        const plan = await this.prisma.plan.findUnique({
            where: { id },
            include: PLAN_INCLUDE,
        });
        if (!plan) throw new NotFoundException(`Plan con ID ${id} no encontrado`);
        return this.withResolvedFeatures(plan);
    }

    async update(id: number, dto: UpdatePlanDto) {
        const currentPlan = await this.prisma.plan.findUniqueOrThrow({
            where: { id },
            select: { id: true, producto: true },
        });

        const { moduloIds, subModuloIds } = dto;
        const planData = this.omitVirtualPlanFields(dto);
        const features = this.normalizeFeaturePayload(dto);
        const producto = dto.producto !== undefined
            ? this.normalizeProducto(dto.producto)
            : this.normalizeProducto(currentPlan.producto);
        const plataforma = dto.plataforma !== undefined
            ? this.normalizePlataforma(dto.plataforma)
            : undefined;

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

            try {
                const plan = await prisma.plan.update({
                    where: { id },
                    data: {
                        ...planData,
                        ...this.extractSchemaFeatures(features),
                        producto,
                        ...(plataforma !== undefined ? { plataforma } : {}),
                        features: {
                            upsert: Object.entries(features).map(([featureKey, enabled]) => ({
                                where: { planId_featureKey: { planId: id, featureKey } },
                                update: { enabled },
                                create: { featureKey, enabled },
                            })),
                        },
                    },
                    include: PLAN_INCLUDE,
                });
                return this.withResolvedFeatures(plan);
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                    throw new BadRequestException(`Ya existe un plan "${dto.nombre || ''}" con esa plataforma/producto`);
                }
                throw error;
            }
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
