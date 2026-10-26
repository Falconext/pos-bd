import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAXIMO_ETIQUETAS_POR_EMPRESA,
  buscarMismoNombre,
  colorValido,
  normalizarNombreEtiqueta,
} from './leads-etiquetas';

export interface EtiquetaResumen {
  id: number;
  nombre: string;
  color: string;
}

const SELECT_ETIQUETA = { id: true, nombre: true, color: true } as const;

/**
 * Etiquetas de contactos: el catálogo de la empresa y quién tiene cuál.
 *
 * Todo va filtrado por el `empresaId` del token. Una etiqueta o una
 * conversación de otra empresa responde 404, igual que si no existiera.
 */
@Injectable()
export class LeadsEtiquetasService {
  constructor(private readonly prisma: PrismaService) {}

  /** El catálogo, con cuántos chats tiene cada una. */
  async listar(empresaId: number) {
    const etiquetas = await this.prisma.leadEtiqueta.findMany({
      where: { empresaId },
      orderBy: { nombre: 'asc' },
      select: {
        ...SELECT_ETIQUETA,
        _count: { select: { conversaciones: true } },
      },
    });
    return etiquetas.map(({ _count, ...e }) => ({
      ...e,
      contactos: _count.conversaciones,
    }));
  }

  async crear(empresaId: number, datos: { nombre?: string; color?: string }) {
    const nombre = normalizarNombreEtiqueta(datos.nombre);
    if (!nombre)
      throw new BadRequestException('La etiqueta necesita un nombre.');
    const existentes = await this.prisma.leadEtiqueta.findMany({
      where: { empresaId },
      select: SELECT_ETIQUETA,
    });
    const repetida = buscarMismoNombre(existentes, nombre);
    if (repetida) {
      throw new ConflictException(
        `Ya existe la etiqueta "${repetida.nombre}".`,
      );
    }
    if (existentes.length >= MAXIMO_ETIQUETAS_POR_EMPRESA) {
      throw new BadRequestException(
        `Llegaste al máximo de ${MAXIMO_ETIQUETAS_POR_EMPRESA} etiquetas. Borra alguna que ya no uses.`,
      );
    }
    return this.prisma.leadEtiqueta.create({
      data: { empresaId, nombre, color: colorValido(datos.color) },
      select: SELECT_ETIQUETA,
    });
  }

  async editar(
    empresaId: number,
    id: number,
    datos: { nombre?: string; color?: string },
  ) {
    await this.etiquetaDe(empresaId, id);
    const data: { nombre?: string; color?: string } = {};
    if (datos.nombre !== undefined) {
      const nombre = normalizarNombreEtiqueta(datos.nombre);
      if (!nombre)
        throw new BadRequestException('La etiqueta necesita un nombre.');
      const existentes = await this.prisma.leadEtiqueta.findMany({
        where: { empresaId },
        select: SELECT_ETIQUETA,
      });
      const repetida = buscarMismoNombre(existentes, nombre, id);
      if (repetida) {
        throw new ConflictException(
          `Ya existe la etiqueta "${repetida.nombre}".`,
        );
      }
      data.nombre = nombre;
    }
    if (datos.color !== undefined) data.color = colorValido(datos.color);
    return this.prisma.leadEtiqueta.update({
      where: { id },
      data,
      select: SELECT_ETIQUETA,
    });
  }

  /** Borrarla la quita de todos los chats (cascada en la tabla intermedia). */
  async eliminar(empresaId: number, id: number) {
    await this.etiquetaDe(empresaId, id);
    const quitadas = await this.prisma.leadConversacionEtiqueta.count({
      where: { etiquetaId: id },
    });
    await this.prisma.leadEtiqueta.delete({ where: { id } });
    return { eliminada: true, quitadasDeContactos: quitadas };
  }

  /**
   * Ponerle una etiqueta a un chat. Acepta una existente (`etiquetaId`) o un
   * nombre: si el nombre ya existe —aunque cambien mayúsculas o tildes— se
   * reutiliza; si no, se crea. Así el que etiqueta desde el chat no termina
   * fabricando "Mayorista" y "mayorista".
   *
   * Poner una que ya tiene no es error: devuelve lo mismo.
   */
  async poner(
    empresaId: number,
    conversacionId: number,
    datos: { etiquetaId?: number; nombre?: string; color?: string },
    usuarioId?: number,
  ): Promise<EtiquetaResumen[]> {
    await this.conversacionDe(empresaId, conversacionId);

    let etiquetaId: number;
    if (datos.etiquetaId) {
      etiquetaId = (await this.etiquetaDe(empresaId, datos.etiquetaId)).id;
    } else {
      const nombre = normalizarNombreEtiqueta(datos.nombre);
      if (!nombre) {
        throw new BadRequestException(
          'Elige una etiqueta o escribe un nombre.',
        );
      }
      const existentes = await this.prisma.leadEtiqueta.findMany({
        where: { empresaId },
        select: SELECT_ETIQUETA,
      });
      const misma = buscarMismoNombre(existentes, nombre);
      etiquetaId = misma
        ? misma.id
        : (await this.crear(empresaId, { nombre, color: datos.color })).id;
    }

    await this.prisma.leadConversacionEtiqueta.upsert({
      where: { conversacionId_etiquetaId: { conversacionId, etiquetaId } },
      create: { conversacionId, etiquetaId, usuarioId: usuarioId ?? null },
      update: {},
    });
    return this.deLaConversacion(empresaId, conversacionId);
  }

  async quitar(
    empresaId: number,
    conversacionId: number,
    etiquetaId: number,
  ): Promise<EtiquetaResumen[]> {
    await this.conversacionDe(empresaId, conversacionId);
    await this.prisma.leadConversacionEtiqueta.deleteMany({
      where: { conversacionId, etiquetaId },
    });
    return this.deLaConversacion(empresaId, conversacionId);
  }

  async deLaConversacion(
    empresaId: number,
    conversacionId: number,
  ): Promise<EtiquetaResumen[]> {
    const filas = await this.prisma.leadConversacionEtiqueta.findMany({
      where: { conversacionId, etiqueta: { empresaId } },
      orderBy: { creadoEn: 'asc' },
      select: { etiqueta: { select: SELECT_ETIQUETA } },
    });
    return filas.map((f) => f.etiqueta);
  }

  private async etiquetaDe(empresaId: number, id: number) {
    const etiqueta = await this.prisma.leadEtiqueta.findFirst({
      where: { id, empresaId },
      select: SELECT_ETIQUETA,
    });
    if (!etiqueta) throw new NotFoundException('Etiqueta no encontrada');
    return etiqueta;
  }

  private async conversacionDe(empresaId: number, id: number) {
    const conv = await this.prisma.leadConversacion.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    return conv;
  }
}
