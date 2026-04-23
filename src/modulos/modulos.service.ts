import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubModuloDto } from './dto/create-submodulo.dto';
import { UpdateSubModuloDto } from './dto/update-submodulo.dto';

@Injectable()
export class ModulosService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.modulo.findMany({
            where: { activo: true },
            orderBy: { orden: 'asc' },
            include: {
                subModulos: {
                    orderBy: { orden: 'asc' },
                },
            },
        });
    }

    async findAllAdmin() {
        return this.prisma.modulo.findMany({
            orderBy: { orden: 'asc' },
            include: {
                subModulos: {
                    orderBy: { orden: 'asc' },
                },
            },
        });
    }

    async findOne(id: number) {
        return this.prisma.modulo.findUnique({
            where: { id },
            include: {
                subModulos: { orderBy: { orden: 'asc' } },
            },
        });
    }

    async findByCodigo(codigo: string) {
        return this.prisma.modulo.findUnique({
            where: { codigo },
            include: {
                subModulos: { orderBy: { orden: 'asc' } },
            },
        });
    }

    async create(data: any) {
        return this.prisma.modulo.create({ data });
    }

    async update(id: number, data: any) {
        return this.prisma.modulo.update({ where: { id }, data });
    }

    async remove(id: number) {
        return this.prisma.modulo.delete({ where: { id } });
    }

    // ── SubModulos ────────────────────────────────────────────────────────────

    async createSubModulo(dto: CreateSubModuloDto) {
        const modulo = await this.prisma.modulo.findUnique({ where: { id: dto.moduloId } });
        if (!modulo) throw new NotFoundException('Módulo no encontrado');

        return this.prisma.subModulo.create({ data: dto });
    }

    async updateSubModulo(id: number, dto: UpdateSubModuloDto) {
        const exists = await this.prisma.subModulo.findUnique({ where: { id } });
        if (!exists) throw new NotFoundException('Submódulo no encontrado');

        return this.prisma.subModulo.update({ where: { id }, data: dto });
    }

    async removeSubModulo(id: number) {
        const exists = await this.prisma.subModulo.findUnique({ where: { id } });
        if (!exists) throw new NotFoundException('Submódulo no encontrado');

        return this.prisma.subModulo.delete({ where: { id } });
    }
}
