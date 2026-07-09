import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateZonaEntregaLogisticaDto } from './dto/create-zona.dto';
import { UpdateZonaEntregaLogisticaDto } from './dto/update-zona.dto';

@Injectable()
export class ZonaEntregaLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number, params?: { activa?: boolean }) {
    return this.prisma.zonaEntregaLogistica.findMany({
      where: {
        empresaId,
        ...(params?.activa !== undefined ? { activa: params.activa } : {}),
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const zona = await this.prisma.zonaEntregaLogistica.findFirst({
      where: { id, empresaId },
    });
    if (!zona) throw new NotFoundException('Zona no encontrada');
    return zona;
  }

  async create(empresaId: number, dto: CreateZonaEntregaLogisticaDto) {
    return this.prisma.zonaEntregaLogistica.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        codigo: dto.codigo,
        color: dto.color,
        poligonoGeoJSON: dto.poligonoGeoJSON ?? null,
        costoBase: dto.costoBase ?? 0,
        costoPorKm: dto.costoPorKm ?? 0,
        dificultad: dto.dificultad ?? 1,
        activa: dto.activa ?? true,
      },
    });
  }

  async update(
    id: number,
    empresaId: number,
    dto: UpdateZonaEntregaLogisticaDto,
  ) {
    await this.findOne(id, empresaId);
    return this.prisma.zonaEntregaLogistica.update({
      where: { id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.codigo !== undefined && { codigo: dto.codigo }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.poligonoGeoJSON !== undefined && {
          poligonoGeoJSON: dto.poligonoGeoJSON,
        }),
        ...(dto.costoBase !== undefined && { costoBase: dto.costoBase }),
        ...(dto.costoPorKm !== undefined && { costoPorKm: dto.costoPorKm }),
        ...(dto.dificultad !== undefined && { dificultad: dto.dificultad }),
        ...(dto.activa !== undefined && { activa: dto.activa }),
      },
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.zonaEntregaLogistica.update({
      where: { id },
      data: { activa: false },
    });
  }
}
