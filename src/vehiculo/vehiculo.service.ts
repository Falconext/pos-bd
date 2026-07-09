import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehiculoDto } from './dto/create-vehiculo.dto';
import { CreateActaDto } from './dto/create-acta.dto';

@Injectable()
export class VehiculoService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    empresaId: number,
    params: {
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where: any = { empresaId };
    if (search) {
      where.OR = [
        { placa: { contains: search.toUpperCase(), mode: 'insensitive' } },
        { marca: { contains: search, mode: 'insensitive' } },
        { modelo: { contains: search, mode: 'insensitive' } },
        { cliente: { nombre: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, vehiculos] = await Promise.all([
      this.prisma.vehiculo.count({ where }),
      this.prisma.vehiculo.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        include: {
          cliente: {
            select: { id: true, nombre: true, nroDoc: true, telefono: true },
          },
          contratos: {
            where: { estado: { in: ['VIGENTE', 'POR_VENCER'] } },
            orderBy: { fechaFin: 'asc' },
            take: 1,
            include: { producto: { select: { id: true, descripcion: true } } },
          },
          actas: {
            orderBy: { creadoEn: 'desc' },
            take: 2,
            select: { id: true, tipo: true, creadoEn: true },
          },
        },
      }),
    ]);

    return {
      data: vehiculos,
      paginacion: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number, empresaId: number) {
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { id, empresaId },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            nroDoc: true,
            telefono: true,
            email: true,
          },
        },
        actas: {
          orderBy: { creadoEn: 'desc' },
          include: {
            usuario: { select: { id: true, nombre: true } },
          },
        },
        contratos: {
          orderBy: { fechaFin: 'desc' },
          include: {
            producto: {
              select: { id: true, descripcion: true, precioUnitario: true },
            },
          },
        },
      },
    });

    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');
    return vehiculo;
  }

  async create(empresaId: number, dto: CreateVehiculoDto) {
    const placa = dto.placa.toUpperCase().trim();

    const exists = await this.prisma.vehiculo.findUnique({
      where: { empresaId_placa: { empresaId, placa } },
    });
    if (exists)
      throw new ConflictException(
        `Ya existe un vehículo con la placa ${placa}`,
      );

    return this.prisma.vehiculo.create({
      data: {
        empresaId,
        placa,
        marca: dto.marca,
        modelo: dto.modelo,
        color: dto.color,
        anio: dto.anio,
        clienteId: dto.clienteId,
        sedeId: dto.sedeId,
        observaciones: dto.observaciones,
      },
      include: {
        cliente: { select: { id: true, nombre: true, nroDoc: true } },
      },
    });
  }

  async update(id: number, empresaId: number, dto: Partial<CreateVehiculoDto>) {
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { id, empresaId },
    });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');

    if (dto.placa) {
      const placa = dto.placa.toUpperCase().trim();
      const conflict = await this.prisma.vehiculo.findUnique({
        where: { empresaId_placa: { empresaId, placa } },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(
          `Ya existe un vehículo con la placa ${placa}`,
        );
      }
      dto.placa = placa;
    }

    return this.prisma.vehiculo.update({
      where: { id },
      data: {
        placa: dto.placa,
        marca: dto.marca,
        modelo: dto.modelo,
        color: dto.color,
        anio: dto.anio,
        clienteId: dto.clienteId,
        sedeId: dto.sedeId,
        observaciones: dto.observaciones,
      },
      include: {
        cliente: { select: { id: true, nombre: true, nroDoc: true } },
      },
    });
  }

  async remove(id: number, empresaId: number) {
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { id, empresaId },
    });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');
    return this.prisma.vehiculo.delete({ where: { id } });
  }

  // ─── Actas de Inspección ───────────────────────────────────────────────────

  async createActa(
    vehiculoId: number,
    empresaId: number,
    usuarioId: number,
    dto: CreateActaDto,
  ) {
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { id: vehiculoId, empresaId },
    });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');

    const data: any = {
      vehiculoId,
      tipo: dto.tipo,
      km: dto.km,
      nivelCombustible: dto.nivelCombustible,
      observaciones: dto.observaciones,
      fotos: dto.fotos ?? [],
      usuarioId,
    };
    if (dto.checklist && dto.checklist.length) data.checklist = dto.checklist;

    return this.prisma.actaInspeccion.create({
      data,
      include: {
        usuario: { select: { id: true, nombre: true } },
      },
    });
  }

  async findActas(vehiculoId: number, empresaId: number) {
    const vehiculo = await this.prisma.vehiculo.findFirst({
      where: { id: vehiculoId, empresaId },
    });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');

    return this.prisma.actaInspeccion.findMany({
      where: { vehiculoId },
      orderBy: { creadoEn: 'desc' },
      include: { usuario: { select: { id: true, nombre: true } } },
    });
  }
}
