import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DisenoRubroService {
    constructor(private readonly prisma: PrismaService) { }

    async obtenerDisenoPorRubro(rubroId: number) {
        const diseno = await this.prisma.disenoRubro.findUnique({
            where: { rubroId },
            include: { rubro: true },
        });
        return diseno;
    }

    async listarTodos() {
        return this.prisma.disenoRubro.findMany({
            include: { rubro: true },
            orderBy: { rubroId: 'asc' },
        });
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
        const disenoBase = empresa.rubro?.disenos || null;
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
                merged.plantillaId = (disenoBase as any).plantillaId;
            }

            return merged;
        }

        return disenoBase;
    }
}
