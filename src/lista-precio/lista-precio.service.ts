import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListaPrecioDto } from './dto/create-lista-precio.dto';
import { UpdateListaPrecioDto } from './dto/update-lista-precio.dto';
import {
  precioConDescuento,
  resolverListaPrecioAplicable,
} from '../common/utils/lista-precio.resolver';

@Injectable()
export class ListaPrecioService {
  constructor(private readonly prisma: PrismaService) {}

  private async validarAsignaciones(
    empresaId: number,
    sedeIds?: number[],
    usuarioIds?: number[],
    clienteIds?: number[],
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
    if (clienteIds && clienteIds.length > 0) {
      const validos = await this.prisma.cliente.count({
        where: { id: { in: clienteIds }, empresaId },
      });
      if (validos !== new Set(clienteIds).size) {
        throw new BadRequestException(
          'Uno o más clientes no pertenecen a tu empresa',
        );
      }
    }
  }

  async create(dto: CreateListaPrecioDto, empresaId: number) {
    await this.validarAsignaciones(
      empresaId,
      dto.sedeIds,
      dto.usuarioIds,
      dto.clienteIds,
    );

    const lista = await this.prisma.listaPrecio.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        activo: dto.activo ?? true,
        esPorDefecto: dto.esPorDefecto ?? false,
        orden: dto.orden ?? 0,
        sedes: dto.sedeIds?.length
          ? { create: dto.sedeIds.map((sedeId) => ({ sedeId })) }
          : undefined,
        usuarios: dto.usuarioIds?.length
          ? { create: dto.usuarioIds.map((usuarioId) => ({ usuarioId })) }
          : undefined,
        clientes: dto.clienteIds?.length
          ? { create: dto.clienteIds.map((clienteId) => ({ clienteId })) }
          : undefined,
        items: dto.items?.length
          ? {
              create: dto.items.map((it) => ({
                productoId: it.productoId,
                presentacionCodigo: it.presentacionCodigo || '',
                precioUnitario: it.precioUnitario,
                precioOferta: it.precioOferta ?? null,
                descuentoPorcentaje: it.descuentoPorcentaje ?? null,
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
      // Se listan en el mismo orden en que se resuelven, para que la pantalla
      // se lea como lo que es: una tabla de prioridad.
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      include: {
        sedes: { select: { sede: { select: { id: true, nombre: true } } } },
        usuarios: { select: { usuario: { select: { id: true, nombre: true } } } },
        clientes: { select: { cliente: { select: { id: true, nombre: true } } } },
        _count: { select: { items: true } },
      },
    });
    return listas.map((l) => ({
      ...l,
      sedeIds: l.sedes.map((s) => s.sede.id),
      usuarioIds: l.usuarios.map((u) => u.usuario.id),
      clienteIds: l.clientes.map((c) => c.cliente.id),
      // Nombres para pintar las columnas Cliente/Empleado/Tienda sin que el
      // front tenga que cruzar tres listados.
      sedeNombres: l.sedes.map((s) => s.sede.nombre),
      usuarioNombres: l.usuarios.map((u) => u.usuario.nombre),
      clienteNombres: l.clientes.map((c) => c.cliente.nombre),
      totalItems: l._count.items,
      sedes: undefined,
      usuarios: undefined,
      clientes: undefined,
      _count: undefined,
    }));
  }

  async findOne(id: number, empresaId: number) {
    const lista = await this.prisma.listaPrecio.findFirst({
      where: { id, empresaId },
      include: {
        sedes: { select: { sedeId: true } },
        usuarios: { select: { usuarioId: true } },
        clientes: { select: { cliente: { select: { id: true, nombre: true } } } },
        items: {
          select: {
            productoId: true,
            presentacionCodigo: true,
            precioUnitario: true,
            precioOferta: true,
            descuentoPorcentaje: true,
          },
        },
      },
    });
    if (!lista) throw new NotFoundException('Lista de precio no encontrada');
    return {
      ...lista,
      sedeIds: lista.sedes.map((s) => s.sedeId),
      usuarioIds: lista.usuarios.map((u) => u.usuarioId),
      clienteIds: lista.clientes.map((c) => c.cliente.id),
      // El modal necesita el nombre para pintar los chips ya elegidos sin
      // tener que buscar cada cliente por separado.
      clientes: lista.clientes.map((c) => c.cliente),
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

    await this.validarAsignaciones(
      empresaId,
      dto.sedeIds,
      dto.usuarioIds,
      dto.clienteIds,
    );

    await this.prisma.listaPrecio.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        activo: dto.activo,
        esPorDefecto: dto.esPorDefecto,
        orden: dto.orden,
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

    // Sincronizar clientes asignados.
    if (dto.clienteIds !== undefined) {
      await this.prisma.listaPrecioCliente.deleteMany({
        where: { listaPrecioId: id },
      });
      if (dto.clienteIds.length > 0) {
        await this.prisma.listaPrecioCliente.createMany({
          data: dto.clienteIds.map((clienteId) => ({
            listaPrecioId: id,
            clienteId,
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
            descuentoPorcentaje: it.descuentoPorcentaje ?? null,
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
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        nombre: true,
        descripcion: true,
        esPorDefecto: true,
        activo: true,
        items: {
          where: { productoId },
          select: {
            presentacionCodigo: true,
            precioUnitario: true,
            precioOferta: true,
            descuentoPorcentaje: true,
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
      descuentoPorcentaje?: number | null;
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
          descuentoPorcentaje: e.descuentoPorcentaje ?? null,
        },
        update: {
          precioUnitario: e.precioUnitario,
          precioOferta: e.precioOferta ?? null,
          descuentoPorcentaje: e.descuentoPorcentaje ?? null,
        },
      });
    }
    return this.itemsDeProducto(productoId, empresaId);
  }

  /**
   * Lo que el POS necesita para pintar el selector: las listas activas que el
   * cajero puede elegir y cuál le aplica sola si no toca nada.
   *
   * Lo consume el VENDEDOR, no el administrador: por eso devuelve lo mínimo
   * (id y nombre) y no los precios, que podrían filtrar márgenes a quien tiene
   * `ocultarPrecioCosto`.
   */
  async aplicables(
    empresaId: number,
    usuarioId?: number,
    sedeId?: number,
    clienteId?: number,
  ) {
    const listas = await this.prisma.listaPrecio.findMany({
      where: { empresaId, activo: true },
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      select: { id: true, nombre: true, descripcion: true, esPorDefecto: true },
    });
    const resuelta = await resolverListaPrecioAplicable(this.prisma, {
      empresaId,
      usuarioId,
      sedeId,
      clienteId,
    });
    return { listas, listaResueltaId: resuelta?.id ?? null };
  }

  /**
   * Reordena las listas: la posición decide quién gana cuando dos podrían
   * aplicar. Se guarda el orden completo de una vez (como llega de arrastrar
   * la tabla) en vez de campo por campo, para que no queden dos listas con el
   * mismo `orden` a mitad de camino.
   */
  async reordenar(empresaId: number, ids: number[]) {
    const propias = await this.prisma.listaPrecio.count({
      where: { id: { in: ids }, empresaId },
    });
    if (propias !== new Set(ids).size) {
      throw new ForbiddenException('Una o más listas no pertenecen a tu empresa');
    }
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.listaPrecio.update({ where: { id }, data: { orden: i } }),
      ),
    );
    return this.findAll(empresaId);
  }

  /**
   * Precio efectivo de cada línea del carrito bajo una lista dada, para
   * reprecificar al vuelo cuando el cajero cambia de lista a mitad de venta.
   *
   * Respeta la presentación: la unidad busca su precio de unidad y el paquete
   * el suyo. Si la lista no fija precio para esa presentación, cae en el
   * override de la sede y luego en el precio base — la misma precedencia que
   * usa el catálogo, para que carrito y catálogo nunca muestren cosas distintas.
   */
  async preciosDeLineas(
    empresaId: number,
    sedeId: number | undefined,
    listaPrecioId: number | undefined,
    lineas: Array<{ productoId: number; presentacionCodigo?: string }>,
  ) {
    const productoIds = [
      ...new Set(
        (lineas || []).map((l) => Number(l.productoId)).filter((id) => id > 0),
      ),
    ];
    if (productoIds.length === 0) return { precios: [] };

    const lista = listaPrecioId
      ? await this.prisma.listaPrecio.findFirst({
          where: { id: listaPrecioId, empresaId, activo: true },
          select: { id: true, items: true },
        })
      : null;

    const itemsLista = new Map<string, number>();
    for (const it of lista?.items ?? []) {
      itemsLista.set(
        `${it.productoId}|${it.presentacionCodigo || ''}`,
        precioConDescuento(it.precioUnitario, it.descuentoPorcentaje),
      );
    }

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: productoIds }, empresaId },
      select: {
        id: true,
        precioUnitario: true,
        codigosBarras: {
          select: { codigo: true, unidadesPorPaquete: true, precioPaquete: true },
        },
        stocks: sedeId
          ? {
              where: { sedeId },
              select: { precioUnitarioOverride: true },
            }
          : false,
      },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));

    const precios = (lineas || []).map((l) => {
      const productoId = Number(l.productoId);
      const presentacionCodigo = l.presentacionCodigo || '';
      const producto: any = porId.get(productoId);

      const desdeLista = itemsLista.get(`${productoId}|${presentacionCodigo}`);
      if (desdeLista != null) {
        return { productoId, presentacionCodigo, precioUnitario: desdeLista };
      }
      if (!producto) {
        return { productoId, presentacionCodigo, precioUnitario: null };
      }

      // Precio de la UNIDAD bajo esta misma lista (o el override de la sede, o
      // el precio base). Es la base de todo lo demás.
      const override = producto.stocks?.[0]?.precioUnitarioOverride;
      const precioUnidad =
        itemsLista.get(`${productoId}|`) ??
        (override != null
          ? Number(override)
          : Number(producto.precioUnitario ?? 0));

      if (!presentacionCodigo) {
        return { productoId, presentacionCodigo, precioUnitario: precioUnidad };
      }

      // La presentación no tiene precio propio en la lista: vale su precio de
      // paquete y, si tampoco lo tiene, unidades × precio de la unidad EN ESTA
      // LISTA. Devolver acá el precio de la unidad era el bug: quien llama
      // espera el total de la presentación y lo divide entre las unidades, así
      // que un pack de 12 salía a la doceava parte de lo que debía.
      const paq = (producto.codigosBarras || []).find(
        (c: any) => c.codigo === presentacionCodigo,
      );
      if (paq?.precioPaquete != null && Number(paq.precioPaquete) > 0) {
        return {
          productoId,
          presentacionCodigo,
          precioUnitario: Number(paq.precioPaquete),
        };
      }
      const unidades = Math.max(1, Number(paq?.unidadesPorPaquete) || 1);
      return {
        productoId,
        presentacionCodigo,
        precioUnitario: precioUnidad * unidades,
      };
    });

    return { precios };
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
