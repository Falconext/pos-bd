import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriaService {
  constructor(private readonly prisma: PrismaService) { }

  async crear(nombre: string, empresaId: number) {
    const existe = await this.prisma.categoria.findFirst({
      where: { nombre, empresaId },
    });
    if (existe)
      throw new ForbiddenException(
        'Ya existe una categoría con ese nombre en tu empresa',
      );
    return this.prisma.categoria.create({ data: { nombre, empresaId } });
  }

  async listar(empresaId: number) {
    return this.prisma.categoria.findMany({
      where: { empresaId },
      orderBy: { id: 'desc' },
      include: {
        _count: {
          select: { productos: true },
        },
      },
    });
  }

  async obtenerPorId(id: number, empresaId: number) {
    const categoria = await this.prisma.categoria.findFirst({
      where: { id, empresaId },
    });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');
    return categoria;
  }

  async actualizar(id: number, nombre: string, empresaId: number) {
    const categoria = await this.prisma.categoria.findFirst({
      where: { id, empresaId },
    });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.categoria.update({ where: { id }, data: { nombre } });
  }

  async eliminar(id: number, empresaId: number) {
    const categoria = await this.prisma.categoria.findFirst({
      where: { id, empresaId },
    });
    if (!categoria) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.categoria.delete({ where: { id } });
  }
}
