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

        const maxSedes = empresa.plan?.maxSedes ?? 1; // Default a 1 si no hay plan definido
        const sedesIlimitadas = maxSedes === 0;

        if (!sedesIlimitadas && sedesCount >= maxSedes) {
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

        // Inicializar stock de la nueva sede copiando el stock de la sede principal
        // (como punto de partida; luego cada sede gestiona su inventario de forma independiente)
        const sedePrincipal = await this.prisma.sede.findFirst({
            where: { empresaId, esPrincipal: true, activo: true, id: { not: sede.id } },
        });

        // Obtener stocks actuales de la sede principal (o en 0 si no hay sede principal aún)
        const stocksPrincipal = sedePrincipal
            ? await this.prisma.productoStock.findMany({
                where: { sedeId: sedePrincipal.id },
                select: { productoId: true, stock: true, stockMinimo: true, stockMaximo: true },
              })
            : [];

        // Construir mapa para acceso rápido
        const stockMap = new Map(stocksPrincipal.map(s => [s.productoId, s]));

        const productos = await this.prisma.producto.findMany({
            where: { empresaId },
            select: { id: true, stock: true, stockMinimo: true, stockMaximo: true },
        });

        if (productos.length > 0) {
            const stocksData = productos.map(p => {
                const ref = stockMap.get(p.id);
                return {
                    productoId: p.id,
                    sedeId: sede.id,
                    // Copiar stock de la sede principal; si no existe, usar el campo legacy del producto
                    stock: ref ? ref.stock : (p.stock ?? 0),
                    stockMinimo: ref ? (ref.stockMinimo ?? 0) : (p.stockMinimo ?? 0),
                    stockMaximo: ref ? ref.stockMaximo : p.stockMaximo,
                };
            });
            await this.prisma.productoStock.createMany({ data: stocksData });
        }

        return sede;
    }

    async findAll(empresaId: number) {
        return this.prisma.sede.findMany({
            where: { empresaId },
            orderBy: [{ esPrincipal: 'desc' }, { activo: 'desc' }],
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

    /**
     * Sincroniza el stock de una sede copiando desde la sede principal.
     * Útil para sedes que ya existen pero tienen stock en 0 por la configuración anterior.
     * Solo actualiza registros con stock = 0 para no pisar ventas ya registradas.
     */
    async sincronizarStockDesdePrincipal(sedeId: number, empresaId: number) {
        const sede = await this.prisma.sede.findFirst({
            where: { id: sedeId, empresaId },
        });
        if (!sede) throw new NotFoundException('Sede no encontrada');

        const sedePrincipal = await this.prisma.sede.findFirst({
            where: { empresaId, esPrincipal: true, activo: true, id: { not: sedeId } },
        });
        if (!sedePrincipal) throw new NotFoundException('No hay sede principal configurada');

        const stocksPrincipal = await this.prisma.productoStock.findMany({
            where: { sedeId: sedePrincipal.id },
            select: { productoId: true, stock: true, stockMinimo: true, stockMaximo: true },
        });

        let actualizados = 0;
        for (const sp of stocksPrincipal) {
            // Solo actualizar si el stock de la sede destino sigue en 0 (no pisamos operaciones reales)
            const stockActual = await this.prisma.productoStock.findUnique({
                where: { productoId_sedeId: { productoId: sp.productoId, sedeId } },
            });
            if (stockActual && stockActual.stock === 0) {
                await this.prisma.productoStock.update({
                    where: { productoId_sedeId: { productoId: sp.productoId, sedeId } },
                    data: {
                        stock: sp.stock,
                        stockMinimo: sp.stockMinimo ?? 0,
                        stockMaximo: sp.stockMaximo,
                    },
                });
                actualizados++;
            }
        }

        return {
            message: `Stock sincronizado correctamente desde la sede principal`,
            productosActualizados: actualizados,
        };
    }
}
