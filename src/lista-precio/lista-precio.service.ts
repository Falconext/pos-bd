import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListaPrecioDto } from './dto/create-lista-precio.dto';
import { UpdateListaPrecioDto } from './dto/update-lista-precio.dto';

@Injectable()
export class ListaPrecioService {
  constructor(private readonly prisma: PrismaService) {}

  private async validarSedesYUsuarios(
    empresaId: number,
    sedeIds?: number[],
    usuarioIds?: number[],
  ) {
    if (sedeIds && sedeIds.length > 0) {
      const validas = await this.prisma.sede.count({
        where: { id: { in: sedeIds }, empresaId },
      });
      if (validas !== new Set(sedeIds).size) {
        throw new BadRequestException(
          'Una o más sedes no pertenecen a tu empresa',
        );
      }
    }
    if (usuarioIds && usuarioIds.length > 0) {
      const validos = await this.prisma.usuario.count({
        where: { id: { in: usuarioIds }, empresaId },
      });
      if (validos !== new Set(usuarioIds).size) {
        throw new BadRequestException(
          'Uno o más usuarios no pertenecen a tu empresa',
        );
      }
    }
  }

  async create(dto: CreateListaPrecioDto, empresaId: number) {
    await this.validarSedesYUsuarios(empresaId, dto.sedeIds, dto.usuarioIds);

    const lista = await this.prisma.listaPrecio.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        activo: dto.activo ?? true,
        esPorDefecto: dto.esPorDefecto ?? false,
        sedes: dto.sedeIds?.length
          ? { create: dto.sedeIds.map((sedeId) => ({ sedeId })) }
          : undefined,
        usuarios: dto.usuarioIds?.length
          ? { create: dto.usuarioIds.map((usuarioId) => ({ usuarioId })) }
          : undefined,
        items: dto.items?.length
          ? {
              create: dto.items.map((it) => ({
                productoId: it.productoId,
                presentacionCodigo: it.presentacionCodigo || '',
                precioUnitario: it.precioUnitario,
                precioOferta: it.precioOferta ?? null,
              })),
            }
          : undefined,
      },
    });

    // Solo una lista default por empresa: si esta es default, desmarca las demás.
    if (lista.esPorDefecto) {
      await this.prisma.listaPrecio.updateMany({
        where: { empresaId, id: { not: lista.id }, esPorDefecto: true },
        data: { esPorDefecto: false },
      });
    }

    return this.findOne(lista.id, empresaId);
  }

  async findAll(empresaId: number) {
    const listas = await this.prisma.listaPrecio.findMany({
      where: { empresaId },
      orderBy: [{ esPorDefecto: 'desc' }, { nombre: 'asc' }],
      include: {
        sedes: { select: { sedeId: true } },
        usuarios: { select: { usuarioId: true } },
        _count: { select: { items: true } },
      },
    });
    return listas.map((l) => ({
      ...l,
      sedeIds: l.sedes.map((s) => s.sedeId),
      usuarioIds: l.usuarios.map((u) => u.usuarioId),
      totalItems: l._count.items,
      sedes: undefined,
      usuarios: undefined,
      _count: undefined,
    }));
  }

  async findOne(id: number, empresaId: number) {
    const lista = await this.prisma.listaPrecio.findFirst({
      where: { id, empresaId },
      include: {
        sedes: { select: { sedeId: true } },
        usuarios: { select: { usuarioId: true } },
        items: {
          select: {
            productoId: true,
            presentacionCodigo: true,
            precioUnitario: true,
            precioOferta: true,
          },
        },
      },
    });
    if (!lista) throw new NotFoundException('Lista de precio no encontrada');
    return {
      ...lista,
      sedeIds: lista.sedes.map((s) => s.sedeId),
      usuarioIds: lista.usuarios.map((u) => u.usuarioId),
      sedes: undefined,
      usuarios: undefined,
    };
  }

  async update(id: number, dto: UpdateListaPrecioDto, empresaId: number) {
    const existe = await this.prisma.listaPrecio.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Lista de precio no encontrada');

    await this.validarSedesYUsuarios(empresaId, dto.sedeIds, dto.usuarioIds);

    await this.prisma.listaPrecio.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        activo: dto.activo,
        esPorDefecto: dto.esPorDefecto,
      },
    });

    // Sincronizar sedes asignadas (reemplazo total como usuarios.service sedeIds).
    if (dto.sedeIds !== undefined) {
      await this.prisma.listaPrecioSede.deleteMany({
        where: { listaPrecioId: id },
      });
      if (dto.sedeIds.length > 0) {
        await this.prisma.listaPrecioSede.createMany({
          data: dto.sedeIds.map((sedeId) => ({ listaPrecioId: id, sedeId })),
          skipDuplicates: true,
        });
      }
    }

    // Sincronizar usuarios asignados.
    if (dto.usuarioIds !== undefined) {
      await this.prisma.listaPrecioUsuario.deleteMany({
        where: { listaPrecioId: id },
      });
      if (dto.usuarioIds.length > 0) {
        await this.prisma.listaPrecioUsuario.createMany({
          data: dto.usuarioIds.map((usuarioId) => ({
            listaPrecioId: id,
            usuarioId,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Reemplazar items (upsert en bloque: borra y recrea).
    if (dto.items !== undefined) {
      await this.prisma.listaPrecioItem.deleteMany({
        where: { listaPrecioId: id },
      });
      if (dto.items.length > 0) {
        await this.prisma.listaPrecioItem.createMany({
          data: dto.items.map((it) => ({
            listaPrecioId: id,
            productoId: it.productoId,
            presentacionCodigo: it.presentacionCodigo || '',
            precioUnitario: it.precioUnitario,
            precioOferta: it.precioOferta ?? null,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (dto.esPorDefecto) {
      await this.prisma.listaPrecio.updateMany({
        where: { empresaId, id: { not: id }, esPorDefecto: true },
        data: { esPorDefecto: false },
      });
    }

    return this.findOne(id, empresaId);
  }

  /**
   * Precios de un producto en TODAS las listas de la empresa (para el panel de
   * la ficha del producto). Devuelve la lista + el item de ese producto si existe.
   */
  async itemsDeProducto(productoId: number, empresaId: number) {
    const listas = await this.prisma.listaPrecio.findMany({
      where: { empresaId },
      orderBy: [{ esPorDefecto: 'desc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        esPorDefecto: true,
        activo: true,
        items: {
          where: { productoId },
          select: {
            presentacionCodigo: true,
            precioUnitario: true,
            precioOferta: true,
          },
        },
      },
    });
    return listas;
  }

  /**
   * Fija/actualiza los precios de UN producto en varias listas, sin tocar los
   * items de otros productos. Cada entrada = una presentación en una lista.
   */
  async upsertItemsDeProducto(
    productoId: number,
    empresaId: number,
    entradas: Array<{
      listaPrecioId: number;
      presentacionCodigo?: string;
      precioUnitario: number;
      precioOferta?: number | null;
    }>,
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    // Validar que todas las listas pertenezcan a la empresa.
    const listaIds = [...new Set(entradas.map((e) => e.listaPrecioId))];
    if (listaIds.length > 0) {
      const validas = await this.prisma.listaPrecio.count({
        where: { id: { in: listaIds }, empresaId },
      });
      if (validas !== listaIds.length) {
        throw new ForbiddenException(
          'Una o más listas no pertenecen a tu empresa',
        );
      }
    }

    for (const e of entradas) {
      const presentacionCodigo = e.presentacionCodigo || '';
      await this.prisma.listaPrecioItem.upsert({
        where: {
          listaPrecioId_productoId_presentacionCodigo: {
            listaPrecioId: e.listaPrecioId,
            productoId,
            presentacionCodigo,
          },
        },
        create: {
          listaPrecioId: e.listaPrecioId,
          productoId,
          presentacionCodigo,
          precioUnitario: e.precioUnitario,
          precioOferta: e.precioOferta ?? null,
        },
        update: {
          precioUnitario: e.precioUnitario,
          precioOferta: e.precioOferta ?? null,
        },
      });
    }
    return this.itemsDeProducto(productoId, empresaId);
  }

  async remove(id: number, empresaId: number) {
    const existe = await this.prisma.listaPrecio.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Lista de precio no encontrada');
    await this.prisma.listaPrecio.delete({ where: { id } });
    return { ok: true };
  }
}
