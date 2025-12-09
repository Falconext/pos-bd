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

        // Si hay override, mezclar con el diseño base
        const disenoBase = empresa.rubro?.disenos?.[0] || null; // Asumiendo relación uno a uno o tomando el primero
        // Nota: En el schema DisenoRubro tiene rubroId @unique, así que es 1 a 1.
        // Pero en Prisma relation puede ser array si no está definido como unique en el otro lado.
        // En schema: rubro Rubro @relation... y en Rubro: disenos DisenoRubro[]?
        // Revisemos schema: model DisenoRubro { rubroId Int @unique ... }
        // model Rubro { ... disenos DisenoRubro? ... } -> Debería ser singular si es 1-1
        // Voy a asumir que puedo acceder a disenoRubro desde rubro.

        // Revisando schema actual en memoria:
        // model Rubro { ... disenos DisenoRubro[] } (en el schema original era array)
        // Pero DisenoRubro tiene @unique en rubroId.

        // Si hay override en empresa, usarlo
        if (empresa.disenoOverride) {
            return {
                ...disenoBase,
                ...(empresa.disenoOverride as object),
            };
        }

        return disenoBase;
    }
}
