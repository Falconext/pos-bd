import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSedeDto } from './dto/create-sede.dto';
import { UpdateSedeDto } from './dto/update-sede.dto';

@Injectable()
export class SedeService {
    constructor(private readonly prisma: PrismaService) { }

    async create(createSedeDto: CreateSedeDto, empresaId: number) {
        // Validar límite del plan
        const empresa = await this.prisma.empresa.findUnique({
            where: { id: empresaId },
            include: { plan: true },
        });

        if (!empresa) throw new NotFoundException('Empresa no encontrada');

        const sedesCount = await this.prisma.sede.count({
            where: { empresaId, activo: true },
        });

        const maxSedes = empresa.plan?.maxSedes || 1; // Default a 1 si no hay plan definido

        if (sedesCount >= maxSedes) {
            throw new ForbiddenException(
                `Has alcanzado el límite de sedes permitido por tu plan (${maxSedes}). Actualiza tu plan para agregar más.`
            );
        }

        // Si es principal, desmarcar otras principales
        if (createSedeDto.esPrincipal) {
            await this.prisma.sede.updateMany({
                where: { empresaId, esPrincipal: true },
                data: { esPrincipal: false },
            });
        }

        const sede = await this.prisma.sede.create({
            data: {
                ...createSedeDto,
                empresaId,
            },
        });

        // Crear stocks en 0 para todos los productos de la empresa
        const productos = await this.prisma.producto.findMany({
            where: { empresaId }
        });

        if (productos.length > 0) {
            // En lote
            const stocksData = productos.map(p => ({
                productoId: p.id,
                sedeId: sede.id,
                stock: 0
            }));
            await this.prisma.productoStock.createMany({
                data: stocksData
            });
        }

        return sede;
    }

    async findAll(empresaId: number) {
        return this.prisma.sede.findMany({
            where: { empresaId, activo: true },
            orderBy: { esPrincipal: 'desc' },
        });
    }

    async findOne(id: number) {
        const sede = await this.prisma.sede.findUnique({
            where: { id },
        });
        if (!sede) throw new NotFoundException('Sede no encontrada');
        return sede;
    }

    async update(id: number, updateSedeDto: UpdateSedeDto, empresaId: number) {
        if (updateSedeDto.esPrincipal) {
            await this.prisma.sede.updateMany({
                where: { empresaId, esPrincipal: true },
                data: { esPrincipal: false },
            });
        }
        return this.prisma.sede.update({
            where: { id },
            data: updateSedeDto,
        });
    }

    async remove(id: number) {
        // Soft delete
        return this.prisma.sede.update({
            where: { id },
            data: { activo: false },
        });
    }
}
