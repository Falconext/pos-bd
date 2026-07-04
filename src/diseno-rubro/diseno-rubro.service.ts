import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_TEMPLATE_CONFIGS: Record<string, { premium: boolean; precioSoles: number; premiumNote?: string }> = {
    maye: {
        premium: true,
        precioSoles: 199,
        premiumNote: 'Compra única aparte del plan',
    },
};

const normalizeRubroName = (value?: string | null) =>
    String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const shouldUseConstruccionTemplate = (rubroNombre?: string | null) => {
    const rubro = normalizeRubroName(rubroNombre);
    return rubro.includes('materiales de construccion') || rubro.includes('construccion y obras');
};

const replaceLegacyConstruccionTemplate = (plantillaId?: string | null, rubroNombre?: string | null) => {
    if (!plantillaId || !shouldUseConstruccionTemplate(rubroNombre)) return plantillaId;
    const items = String(plantillaId).split(',').map(item => item.trim()).filter(Boolean);
    if (items.length === 0) return plantillaId;
    const normalized = items.map(item => item === 'tecnica' ? 'construccion' : item);
    return Array.from(new Set(normalized)).join(',');
};

@Injectable()
export class DisenoRubroService {
    constructor(private readonly prisma: PrismaService) { }

    private normalizePlantillaConfig(row: any) {
        return {
            id: String(row.id),
            premium: Boolean(row.premium),
            precioSoles: Number(row.precioSoles || 0),
            premiumNote: row.premiumNote || '',
        };
    }

    async listarPlantillasConfig() {
        const rows = await this.prisma.plantillaTiendaConfig.findMany({
            orderBy: { id: 'asc' },
        });

        const map = new Map<string, any>();
        Object.entries(DEFAULT_TEMPLATE_CONFIGS).forEach(([id, config]) => {
            map.set(id, this.normalizePlantillaConfig({ id, ...config }));
        });
        rows.forEach(row => {
            map.set(row.id, this.normalizePlantillaConfig(row));
        });

        return Array.from(map.values());
    }

    async obtenerPlantillaConfig(plantillaId: string) {
        const id = String(plantillaId || '').trim();
        if (!id) return null;

        const row = await this.prisma.plantillaTiendaConfig.findUnique({ where: { id } });
        if (row) return this.normalizePlantillaConfig(row);

        const fallback = DEFAULT_TEMPLATE_CONFIGS[id];
        return fallback ? this.normalizePlantillaConfig({ id, ...fallback }) : null;
    }

    async guardarPlantillaConfig(plantillaId: string, data: Record<string, any>) {
        const id = String(plantillaId || '').trim();
        if (!id) throw new BadRequestException('Plantilla inválida');

        const premium = Boolean(data?.premium);
        const precioSoles = Number(data?.precioSoles ?? 0);
        if (!Number.isFinite(precioSoles) || precioSoles < 0) {
            throw new BadRequestException('Precio inválido');
        }
        if (premium && precioSoles <= 0) {
            throw new BadRequestException('Una plantilla premium debe tener un precio mayor a cero');
        }

        const premiumNote = typeof data?.premiumNote === 'string'
            ? data.premiumNote.trim().slice(0, 160)
            : '';

        const saved = await this.prisma.plantillaTiendaConfig.upsert({
            where: { id },
            update: { premium, precioSoles, premiumNote },
            create: { id, premium, precioSoles, premiumNote },
        });

        return this.normalizePlantillaConfig(saved);
    }

    async obtenerDisenoPorRubro(rubroId: number) {
        const diseno = await this.prisma.disenoRubro.findUnique({
            where: { rubroId },
            include: { rubro: true },
        });
        if (!diseno) return diseno;
        return {
            ...diseno,
            plantillaId: replaceLegacyConstruccionTemplate(diseno.plantillaId, diseno.rubro?.nombre),
        };
    }

    async listarTodos() {
        const rows = await this.prisma.disenoRubro.findMany({
            include: { rubro: true },
            orderBy: { rubroId: 'asc' },
        });
        return rows.map(row => ({
            ...row,
            plantillaId: replaceLegacyConstruccionTemplate(row.plantillaId, row.rubro?.nombre),
        }));
    }

    async crearOActualizar(rubroId: number, data: Record<string, any>) {
        // Verificar que el rubro existe
        const rubro = await this.prisma.rubro.findUnique({ where: { id: rubroId } });
        if (!rubro) throw new NotFoundException('Rubro no encontrado');

        // Filtrar solo los campos válidos para DisenoRubro (excluir id, rubroId, creadoEn, actualizadoEn, rubro)
        const camposValidos = [
            'colorPrimario',
            'colorSecundario',
            'colorAccento',
            'tipografia',
            'espaciado',
            'bordeRadius',
            'estiloBoton',
            'plantillaId',
            'vistaProductos',
            'tiempoEntregaMin',
            'tiempoEntregaMax',
            'templateHtml',
            'templateCss',
        ];

        const dataFiltrada: Record<string, any> = {};
        for (const campo of camposValidos) {
            if (data[campo] !== undefined) {
                dataFiltrada[campo] = data[campo];
            }
        }

        return this.prisma.disenoRubro.upsert({
            where: { rubroId },
            update: dataFiltrada,
            create: { rubroId, ...dataFiltrada },
            include: { rubro: true },
        });
    }

    async eliminar(rubroId: number) {
        const diseno = await this.prisma.disenoRubro.findUnique({ where: { rubroId } });
        if (!diseno) throw new NotFoundException('Diseño no encontrado');
        return this.prisma.disenoRubro.delete({ where: { rubroId } });
    }

    async obtenerDisenoPorEmpresa(empresaId: number) {
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            include: {
                rubro: {
                    include: {
                        disenos: true,
                    },
                },
            },
        });

        if (!empresa) return null;

        // Si hay override, mezclar con el diseño base.
        // La plantilla base pertenece al rubro y no debe ser reemplazada por overrides de empresa.
        const disenoBase = empresa.rubro?.disenos
            ? {
                ...empresa.rubro.disenos,
                plantillaId: replaceLegacyConstruccionTemplate(
                    (empresa.rubro.disenos as any).plantillaId,
                    empresa.rubro?.nombre,
                ),
            }
            : null;
        const override = empresa.disenoOverride
            ? (typeof empresa.disenoOverride === 'string'
                ? JSON.parse(empresa.disenoOverride)
                : empresa.disenoOverride as object)
            : null;

        if (override) {
            const merged: any = {
                ...disenoBase,
                ...override,
            };

            if ((disenoBase as any)?.plantillaId) {
                const permitidas = String((disenoBase as any).plantillaId)
                    .split(',')
                    .map(item => item.trim())
                    .filter(Boolean);
                const plantillaElegida = typeof (override as any).plantillaId === 'string'
                    ? (override as any).plantillaId.trim()
                    : '';
                if (plantillaElegida && permitidas.includes(plantillaElegida)) {
                    merged.plantillaId = plantillaElegida;
                } else {
                    merged.plantillaId = permitidas[0] || 'moderna';
                }
            }

            return merged;
        }

        if (disenoBase && (disenoBase as any).plantillaId) {
            const permitidas = String((disenoBase as any).plantillaId)
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
            (disenoBase as any).plantillaId = permitidas[0] || 'moderna';
        }

        return disenoBase;
    }
}
