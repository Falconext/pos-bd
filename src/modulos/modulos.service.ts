import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModuloDto } from './dto/create-modulo.dto';
import { UpdateModuloDto } from './dto/update-modulo.dto';
import { CreateSubModuloDto } from './dto/create-submodulo.dto';
import { UpdateSubModuloDto } from './dto/update-submodulo.dto';

@Injectable()
export class ModulosService {
  constructor(private prisma: PrismaService) {}

  private normalizeProducto(
    value?: string | null,
  ): 'facturacion' | 'hotel' | 'logistica' {
    const v = String(value ?? '')
      .trim()
      .toLowerCase();
    if (v === 'hotel') return 'hotel';
    if (v === 'logistica') return 'logistica';
    return 'facturacion';
  }

  private buildProductoWhere(producto?: string) {
    if (!producto) return undefined;
    return { producto: this.normalizeProducto(producto) };
  }

  async findAll(producto?: string) {
    return this.prisma.modulo.findMany({
      where: { activo: true, ...this.buildProductoWhere(producto) },
      orderBy: { orden: 'asc' },
      include: {
        subModulos: {
          orderBy: { orden: 'asc' },
        },
      },
    });
  }

  async findAllAdmin(producto?: string) {
    return this.prisma.modulo.findMany({
      where: this.buildProductoWhere(producto),
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

  async findByCodigo(codigo: string, producto?: string) {
    return this.prisma.modulo.findFirst({
      where: {
        codigo,
        ...(producto ? { producto: this.normalizeProducto(producto) } : {}),
      },
      include: {
        subModulos: { orderBy: { orden: 'asc' } },
      },
    });
  }

  async create(data: CreateModuloDto) {
    return this.prisma.modulo.create({
      data: {
        codigo: data.codigo,
        producto: this.normalizeProducto(data.producto),
        nombre: data.nombre,
        descripcion: data.descripcion ?? null,
        icono: data.icono || null,
        ruta: data.ruta ?? null,
        orden: data.orden ?? 0,
        activo: data.activo ?? true,
      },
    });
  }

  async update(id: number, data: UpdateModuloDto) {
    const modulo = await this.prisma.modulo.findUnique({ where: { id } });
    if (!modulo) throw new NotFoundException('Módulo no encontrado');

    const productoObjetivo =
      data.producto !== undefined
        ? this.normalizeProducto(data.producto)
        : this.normalizeProducto(modulo.producto);

    if (productoObjetivo !== this.normalizeProducto(modulo.producto)) {
      const planesConModulo = await this.prisma.planModulo.count({
        where: { moduloId: id },
      });
      if (planesConModulo > 0) {
        throw new BadRequestException(
          'No puedes cambiar el producto de un módulo asignado a planes',
        );
      }
    }

    return this.prisma.modulo.update({
      where: { id },
      data: {
        ...(data.codigo !== undefined ? { codigo: data.codigo } : {}),
        producto: productoObjetivo,
        ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
        ...(data.descripcion !== undefined
          ? { descripcion: data.descripcion ?? null }
          : {}),
        ...(data.icono !== undefined ? { icono: data.icono || null } : {}),
        ...(data.ruta !== undefined ? { ruta: data.ruta ?? null } : {}),
        ...(data.orden !== undefined ? { orden: data.orden } : {}),
        ...(data.activo !== undefined ? { activo: data.activo } : {}),
      },
    });
  }

  async remove(id: number) {
    return this.prisma.modulo.delete({ where: { id } });
  }

  // ── SubModulos ────────────────────────────────────────────────────────────

  async createSubModulo(dto: CreateSubModuloDto) {
    const modulo = await this.prisma.modulo.findUnique({
      where: { id: dto.moduloId },
    });
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
