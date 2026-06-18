import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getRubroFeatureKeys, RUBRO_FEATURE_CATALOG } from './rubro-feature-catalog';

@Injectable()
export class RubroService {
    constructor(private readonly prisma: PrismaService) { }

    private mapFeatures(features: Array<{ featureKey: string; enabledByDefault: boolean }> = []) {
        const map = new Map(features.map((feature) => [feature.featureKey, feature.enabledByDefault]));
        return getRubroFeatureKeys().reduce<Record<string, boolean>>((acc, key) => {
            acc[key] = Boolean(map.get(key));
            return acc;
        }, {});
    }

    private normalizeRubro(rubro: any) {
        if (!rubro) return rubro;
        return {
            ...rubro,
            features: this.mapFeatures(rubro.features ?? []),
        };
    }

    featureCatalog() {
        return RUBRO_FEATURE_CATALOG;
    }

    async findAll() {
        const rubros = await this.prisma.rubro.findMany({
            orderBy: { nombre: 'asc' },
            include: {
                _count: { select: { empresas: true } },
                features: true,
            },
        });
        return rubros.map((rubro) => this.normalizeRubro(rubro));
    }

    async findOne(id: number) {
        const rubro = await this.prisma.rubro.findUnique({
            where: { id },
            include: {
                _count: { select: { empresas: true } },
                features: true,
            },
        });
        return this.normalizeRubro(rubro);
    }

    async create(nombre: string) {
        const exists = await this.prisma.rubro.findUnique({ where: { nombre } });
        if (exists) throw new ConflictException(`Ya existe un rubro con el nombre "${nombre}"`);
        return this.normalizeRubro(await this.prisma.rubro.create({
            data: {
                nombre,
                features: {
                    create: getRubroFeatureKeys().map((featureKey) => ({
                        featureKey,
                        enabledByDefault: featureKey === 'controlStock',
                    })),
                },
            },
            include: { _count: { select: { empresas: true } }, features: true },
        }));
    }

    async update(id: number, nombre: string) {
        const rubro = await this.prisma.rubro.findUnique({ where: { id } });
        if (!rubro) throw new NotFoundException('Rubro no encontrado');
        return this.normalizeRubro(await this.prisma.rubro.update({
            where: { id },
            data: { nombre },
            include: { _count: { select: { empresas: true } }, features: true },
        }));
    }

    async updateFeatures(id: number, features: Record<string, boolean>) {
        const rubro = await this.prisma.rubro.findUnique({ where: { id } });
        if (!rubro) throw new NotFoundException('Rubro no encontrado');

        const allowed = new Set(getRubroFeatureKeys());
        const entries = Object.entries(features ?? {}).filter(([key]) => allowed.has(key as any));

        await this.prisma.$transaction(
            entries.map(([featureKey, enabledByDefault]) =>
                this.prisma.rubroFeature.upsert({
                    where: { rubroId_featureKey: { rubroId: id, featureKey } },
                    create: { rubroId: id, featureKey, enabledByDefault: Boolean(enabledByDefault) },
                    update: { enabledByDefault: Boolean(enabledByDefault) },
                }),
            ),
        );

        return this.findOne(id);
    }

    async remove(id: number) {
        const rubro = await this.prisma.rubro.findUnique({
            where: { id },
            include: { _count: { select: { empresas: true } } },
        });
        if (!rubro) throw new NotFoundException('Rubro no encontrado');
        if ((rubro as any)._count.empresas > 0) {
            throw new ConflictException(`No se puede eliminar: ${(rubro as any)._count.empresas} empresa(s) usan este rubro`);
        }
        return this.prisma.rubro.delete({ where: { id } });
    }
}
