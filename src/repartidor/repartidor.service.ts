import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRepartidorDto, UpdateRepartidorDto, TipoRepartidorDto } from './dto/repartidor.dto';

@Injectable()
export class RepartidorService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: number, params?: { sedeId?: number; incluirInactivos?: boolean; search?: string }) {
    return this.prisma.repartidor.findMany({
      where: {
        empresaId,
        ...(params?.incluirInactivos ? {} : { activo: true }),
        ...(params?.sedeId ? { OR: [{ sedeId: params.sedeId }, { sedeId: null }] } : {}),
        ...(params?.search?.trim()
          ? { nombre: { contains: params.search.trim(), mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      include: { sede: { select: { id: true, nombre: true, codigo: true, esPrincipal: true } } },
    });
  }

  async findOne(id: number, empresaId: number) {
    const repartidor = await this.prisma.repartidor.findFirst({
      where: { id, empresaId },
      include: { sede: { select: { id: true, nombre: true, codigo: true, esPrincipal: true } } },
    });
    if (!repartidor) throw new NotFoundException('Repartidor no encontrado');
    return repartidor;
  }

  async create(empresaId: number, dto: CreateRepartidorDto) {
    await this.validateSede(empresaId, dto.sedeId);
    await this.validateNombreDisponible(empresaId, dto.nombre);

    return this.prisma.repartidor.create({
      data: {
        empresaId,
        nombre: dto.nombre.trim(),
        celular: this.cleanOptional(dto.celular),
        tipo: dto.tipo ?? TipoRepartidorDto.EVENTUAL,
        sedeId: dto.sedeId ?? null,
        activo: dto.activo ?? true,
      },
      include: { sede: { select: { id: true, nombre: true, codigo: true, esPrincipal: true } } },
    });
  }

  async update(id: number, empresaId: number, dto: UpdateRepartidorDto) {
    await this.findOne(id, empresaId);
    await this.validateSede(empresaId, dto.sedeId);
    if (dto.nombre !== undefined) await this.validateNombreDisponible(empresaId, dto.nombre, id);

    return this.prisma.repartidor.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre.trim() }),
        ...(dto.celular !== undefined && { celular: this.cleanOptional(dto.celular) }),
        ...(dto.tipo !== undefined && { tipo: dto.tipo }),
        ...(dto.sedeId !== undefined && { sedeId: dto.sedeId ?? null }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      },
      include: { sede: { select: { id: true, nombre: true, codigo: true, esPrincipal: true } } },
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.repartidor.update({ where: { id }, data: { activo: false } });
  }

  async resolveForEmpresa(empresaId: number, input?: { repartidorId?: number; repartidor?: string; sedeId?: number | null }) {
    if (input?.repartidorId) {
      const repartidor = await this.prisma.repartidor.findFirst({
        where: { id: input.repartidorId, empresaId, activo: true },
      });
      if (!repartidor) throw new NotFoundException('Repartidor no encontrado');
      return repartidor.id;
    }

    const nombre = input?.repartidor?.trim();
    if (!nombre) return undefined;

    const existing = await this.prisma.repartidor.findFirst({ where: { empresaId, nombre } });
    if (existing) return existing.id;

    const created = await this.prisma.repartidor.create({
      data: {
        empresaId,
        nombre,
        tipo: TipoRepartidorDto.EVENTUAL,
        sedeId: input?.sedeId ?? null,
      },
    });
    return created.id;
  }

  private async validateSede(empresaId: number, sedeId?: number) {
    if (!sedeId) return;
    const sede = await this.prisma.sede.findFirst({ where: { id: sedeId, empresaId } });
    if (!sede) throw new NotFoundException('Sede no encontrada');
  }

  private async validateNombreDisponible(empresaId: number, nombre: string, ignoreId?: number) {
    const clean = nombre.trim();
    if (!clean) throw new BadRequestException('El nombre del repartidor es obligatorio');
    const existing = await this.prisma.repartidor.findFirst({
      where: { empresaId, nombre: clean, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    });
    if (existing) throw new BadRequestException('Ya existe un repartidor con ese nombre');
  }

  private cleanOptional(value?: string) {
    const clean = value?.trim();
    return clean ? clean : null;
  }
}
