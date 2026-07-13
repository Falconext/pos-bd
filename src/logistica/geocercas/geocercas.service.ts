import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGeocercaDto,
  TipoGeocercaLogistica,
} from './dto/create-geocerca.dto';
import { UpdateGeocercaDto } from './dto/update-geocerca.dto';

@Injectable()
export class GeocercasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Distancia en metros entre dos puntos (Haversine). */
  private distanciaMetros(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ) {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async findAll(empresaId: number, params?: { activo?: boolean }) {
    return this.prisma.geocercaLogistica.findMany({
      where: {
        empresaId,
        ...(params?.activo !== undefined ? { activo: params.activo } : {}),
      },
      include: { _count: { select: { eventos: true } } },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const g = await this.prisma.geocercaLogistica.findFirst({
      where: { id, empresaId },
    });
    if (!g) throw new NotFoundException('Geocerca no encontrada');
    return g;
  }

  async create(empresaId: number, dto: CreateGeocercaDto) {
    return this.prisma.geocercaLogistica.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        tipo: dto.tipo ?? TipoGeocercaLogistica.CIRCULO,
        lat: dto.lat,
        lng: dto.lng,
        radio: dto.radio,
        coordenadas: dto.coordenadas,
        color: dto.color,
        activo: dto.activo ?? true,
      },
    });
  }

  async update(id: number, empresaId: number, dto: UpdateGeocercaDto) {
    await this.findOne(id, empresaId);
    return this.prisma.geocercaLogistica.update({
      where: { id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.tipo && { tipo: dto.tipo }),
        ...(dto.lat !== undefined && { lat: dto.lat }),
        ...(dto.lng !== undefined && { lng: dto.lng }),
        ...(dto.radio !== undefined && { radio: dto.radio }),
        ...(dto.coordenadas !== undefined && { coordenadas: dto.coordenadas }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      },
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.geocercaLogistica.delete({ where: { id } });
  }

  async eventos(
    empresaId: number,
    params?: { geocercaId?: number; limit?: number },
  ) {
    return this.prisma.eventoGeocercaLogistica.findMany({
      where: {
        empresaId,
        ...(params?.geocercaId ? { geocercaId: params.geocercaId } : {}),
      },
      include: {
        geocerca: { select: { id: true, nombre: true } },
        dispositivo: { select: { id: true, nombre: true } },
      },
      orderBy: { timestamp: 'desc' },
      take: params?.limit ?? 100,
    });
  }

  async resumen(empresaId: number) {
    const [total, activas, eventos] = await Promise.all([
      this.prisma.geocercaLogistica.count({ where: { empresaId } }),
      this.prisma.geocercaLogistica.count({ where: { empresaId, activo: true } }),
      this.prisma.eventoGeocercaLogistica.count({ where: { empresaId } }),
    ]);
    return { total, activas, eventos };
  }

  /**
   * Evalúa una posición contra las geocercas circulares activas y genera
   * eventos ENTRADA/SALIDA según transición respecto al último evento.
   * Llamado por la ingestión GPS. Devuelve los eventos generados.
   */
  async procesarPosicion(
    empresaId: number,
    input: {
      dispositivoId: number;
      vehiculoId?: number | null;
      lat: number;
      lng: number;
    },
  ) {
    const geocercas = await this.prisma.geocercaLogistica.findMany({
      where: {
        empresaId,
        activo: true,
        tipo: 'CIRCULO',
        lat: { not: null },
        lng: { not: null },
        radio: { not: null },
      },
    });

    const generados: any[] = [];
    for (const g of geocercas) {
      const dentro =
        this.distanciaMetros(
          Number(g.lat),
          Number(g.lng),
          input.lat,
          input.lng,
        ) <= Number(g.radio);

      const ultimo = await this.prisma.eventoGeocercaLogistica.findFirst({
        where: { geocercaId: g.id, dispositivoId: input.dispositivoId },
        orderBy: { timestamp: 'desc' },
      });
      const estabaDentro = ultimo?.tipo === 'ENTRADA';

      if (dentro && !estabaDentro) {
        generados.push(
          await this.prisma.eventoGeocercaLogistica.create({
            data: {
              empresaId,
              geocercaId: g.id,
              dispositivoId: input.dispositivoId,
              vehiculoId: input.vehiculoId ?? null,
              tipo: 'ENTRADA',
              lat: input.lat,
              lng: input.lng,
            },
          }),
        );
      } else if (!dentro && estabaDentro) {
        generados.push(
          await this.prisma.eventoGeocercaLogistica.create({
            data: {
              empresaId,
              geocercaId: g.id,
              dispositivoId: input.dispositivoId,
              vehiculoId: input.vehiculoId ?? null,
              tipo: 'SALIDA',
              lat: input.lat,
              lng: input.lng,
            },
          }),
        );
      }
    }
    return generados;
  }
}
