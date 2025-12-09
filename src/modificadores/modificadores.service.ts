import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrearGrupoModificadorDto, ActualizarGrupoModificadorDto, AsignarModificadoresProductoDto } from './dto';

@Injectable()
export class ModificadoresService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== GRUPOS DE MODIFICADORES ====================

  async crearGrupo(empresaId: number, dto: CrearGrupoModificadorDto) {
    const { opciones, ...grupoData } = dto;

    const grupo = await this.prisma.grupoModificador.create({
      data: {
        ...grupoData,
        empresaId,
        opciones: opciones?.length
          ? {
              create: opciones.map((op, idx) => ({
                nombre: op.nombre,
                descripcion: op.descripcion,
                precioExtra: op.precioExtra ?? 0,
                orden: op.orden ?? idx,
                activo: op.activo ?? true,
                esDefault: op.esDefault ?? false,
              })),
            }
          : undefined,
      },
      include: {
        opciones: {
          where: { activo: true },
          orderBy: { orden: 'asc' },
        },
      },
    });

    return { code: 1, message: 'Grupo creado', data: grupo };
  }

  async listarGrupos(empresaId: number, incluirInactivos = false) {
    const grupos = await this.prisma.grupoModificador.findMany({
      where: {
        empresaId,
        ...(incluirInactivos ? {} : { activo: true }),
      },
      include: {
        opciones: {
          where: incluirInactivos ? {} : { activo: true },
          orderBy: { orden: 'asc' },
        },
        _count: {
          select: { productos: true },
        },
      },
      orderBy: { orden: 'asc' },
    });

    return { code: 1, data: grupos };
  }

  async obtenerGrupo(empresaId: number, grupoId: number) {
    const grupo = await this.prisma.grupoModificador.findFirst({
      where: { id: grupoId, empresaId },
      include: {
        opciones: {
          orderBy: { orden: 'asc' },
        },
        productos: {
          include: {
            producto: {
              select: { id: true, codigo: true, descripcion: true, imagenUrl: true },
            },
          },
        },
      },
    });

    if (!grupo) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }

    return { code: 1, data: grupo };
  }

  async actualizarGrupo(empresaId: number, grupoId: number, dto: ActualizarGrupoModificadorDto) {
    const existe = await this.prisma.grupoModificador.findFirst({
      where: { id: grupoId, empresaId },
    });

    if (!existe) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }

    const { opciones, ...grupoData } = dto;

    // Actualizar grupo
    const grupo = await this.prisma.grupoModificador.update({
      where: { id: grupoId },
      data: grupoData,
      include: {
        opciones: {
          orderBy: { orden: 'asc' },
        },
      },
    });

    return { code: 1, message: 'Grupo actualizado', data: grupo };
  }

  async eliminarGrupo(empresaId: number, grupoId: number) {
    const existe = await this.prisma.grupoModificador.findFirst({
      where: { id: grupoId, empresaId },
    });

    if (!existe) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }

    await this.prisma.grupoModificador.delete({
      where: { id: grupoId },
    });

    return { code: 1, message: 'Grupo eliminado' };
  }

  // ==================== OPCIONES DE MODIFICADORES ====================

  async agregarOpcion(empresaId: number, grupoId: number, dto: { nombre: string; descripcion?: string; precioExtra?: number; orden?: number; esDefault?: boolean }) {
    const grupo = await this.prisma.grupoModificador.findFirst({
      where: { id: grupoId, empresaId },
    });

    if (!grupo) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }

    const opcion = await this.prisma.opcionModificador.create({
      data: {
        grupoId,
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        precioExtra: dto.precioExtra ?? 0,
        orden: dto.orden ?? 0,
        esDefault: dto.esDefault ?? false,
      },
    });

    return { code: 1, message: 'Opción agregada', data: opcion };
  }

  async actualizarOpcion(empresaId: number, opcionId: number, dto: { nombre?: string; descripcion?: string; precioExtra?: number; orden?: number; activo?: boolean; esDefault?: boolean }) {
    const opcion = await this.prisma.opcionModificador.findFirst({
      where: { id: opcionId },
      include: { grupo: true },
    });

    if (!opcion || opcion.grupo.empresaId !== empresaId) {
      throw new NotFoundException('Opción no encontrada');
    }

    const updated = await this.prisma.opcionModificador.update({
      where: { id: opcionId },
      data: dto,
    });

    return { code: 1, message: 'Opción actualizada', data: updated };
  }

  async eliminarOpcion(empresaId: number, opcionId: number) {
    const opcion = await this.prisma.opcionModificador.findFirst({
      where: { id: opcionId },
      include: { grupo: true },
    });

    if (!opcion || opcion.grupo.empresaId !== empresaId) {
      throw new NotFoundException('Opción no encontrada');
    }

    await this.prisma.opcionModificador.delete({
      where: { id: opcionId },
    });

    return { code: 1, message: 'Opción eliminada' };
  }

  // ==================== ASIGNACIÓN A PRODUCTOS ====================

  async asignarGruposAProducto(empresaId: number, productoId: number, dto: AsignarModificadoresProductoDto) {
    // Verificar que el producto pertenece a la empresa
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Verificar que todos los grupos pertenecen a la empresa
    const grupoIds = dto.grupos.map((g) => g.grupoId);
    const gruposValidos = await this.prisma.grupoModificador.findMany({
      where: { id: { in: grupoIds }, empresaId },
    });

    if (gruposValidos.length !== grupoIds.length) {
      throw new BadRequestException('Algunos grupos no pertenecen a esta empresa');
    }

    // Eliminar asignaciones anteriores y crear nuevas
    await this.prisma.$transaction([
      this.prisma.productoGrupoModificador.deleteMany({
        where: { productoId },
      }),
      ...dto.grupos.map((g) =>
        this.prisma.productoGrupoModificador.create({
          data: {
            productoId,
            grupoId: g.grupoId,
            ordenOverride: g.ordenOverride,
          },
        }),
      ),
    ]);

    // Retornar producto con sus grupos
    const productoActualizado = await this.prisma.producto.findUnique({
      where: { id: productoId },
      include: {
        gruposModificadores: {
          include: {
            grupo: {
              include: {
                opciones: {
                  where: { activo: true },
                  orderBy: { orden: 'asc' },
                },
              },
            },
          },
          orderBy: { ordenOverride: 'asc' },
        },
      },
    });

    return { code: 1, message: 'Modificadores asignados', data: productoActualizado };
  }

  async obtenerModificadoresProducto(empresaId: number, productoId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      include: {
        gruposModificadores: {
          include: {
            grupo: {
              include: {
                opciones: {
                  where: { activo: true },
                  orderBy: { orden: 'asc' },
                },
              },
            },
          },
          orderBy: { ordenOverride: 'asc' },
        },
      },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    return { code: 1, data: producto.gruposModificadores };
  }

  // ==================== API PÚBLICA (para tienda virtual) ====================

  async obtenerModificadoresProductoPublico(productoId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, publicarEnTienda: true },
      include: {
        gruposModificadores: {
          include: {
            grupo: {
              select: {
                id: true,
                nombre: true,
                descripcion: true,
                esObligatorio: true,
                seleccionMin: true,
                seleccionMax: true,
                orden: true,
                opciones: {
                  where: { activo: true },
                  select: {
                    id: true,
                    nombre: true,
                    descripcion: true,
                    precioExtra: true,
                    esDefault: true,
                    orden: true,
                  },
                  orderBy: { orden: 'asc' },
                },
              },
            },
          },
          orderBy: { ordenOverride: 'asc' },
        },
      },
    });

    if (!producto) {
      return { code: 0, data: [] };
    }

    // Formatear respuesta para el frontend
    const grupos = producto.gruposModificadores.map((pgm) => ({
      ...pgm.grupo,
      ordenOverride: pgm.ordenOverride,
    }));

    return { code: 1, data: grupos };
  }
}
