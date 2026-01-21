import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ModulosService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.modulo.findMany({
            where: { activo: true },
            orderBy: { orden: 'asc' },
        });
    }

    async findOne(id: number) {
        return this.prisma.modulo.findUnique({
            where: { id },
        });
    }

    async findByCodigo(codigo: string) {
        return this.prisma.modulo.findUnique({
            where: { codigo },
        });
    }

    async create(data: any) {
        return this.prisma.modulo.create({
            data,
        });
    }

    async update(id: number, data: any) {
        return this.prisma.modulo.update({
            where: { id },
            data,
        });
    }

    async remove(id: number) {
        // Soft delete or hard delete depending on requirements.
        // For safe admin, maybe just disable? Or hard delete if no relations.
        // Let's assume hard delete but cascading should be handled by DB.
        // Or safer: check usage.
        return this.prisma.modulo.delete({
            where: { id },
        });
    }
}
