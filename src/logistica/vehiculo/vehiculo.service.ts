import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateVehiculoLogisticaDto,
  EstadoVehiculoLogistica,
} from './dto/create-vehiculo.dto';
import { UpdateVehiculoLogisticaDto } from './dto/update-vehiculo.dto';

@Injectable()
export class VehiculoLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    empresaId: number,
    params?: { search?: string; estado?: string },
  ) {
    return this.prisma.vehiculoLogistica.findMany({
      where: {
        empresaId,
        ...(params?.estado
          ? { estado: params.estado as EstadoVehiculoLogistica }
          : {}),
        ...(params?.search
          ? {
              OR: [
                { placa: { contains: params.search, mode: 'insensitive' } },
                { marca: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        tipoVehiculo: true,
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const vehiculo = await this.prisma.vehiculoLogistica.findFirst({
      where: { id, empresaId },
      include: {
        tipoVehiculo: true,
      },
    });
    if (!vehiculo) throw new NotFoundException('Vehículo no encontrado');
    return vehiculo;
  }

  async create(empresaId: number, dto: CreateVehiculoLogisticaDto) {
    const existing = await this.prisma.vehiculoLogistica.findUnique({
      where: { empresaId_placa: { empresaId, placa: dto.placa } },
    });
    if (existing)
      throw new ConflictException(
        'Ya existe un vehículo con esa placa en esta empresa',
      );

    return this.prisma.vehiculoLogistica.create({
      data: {
        empresaId,
        tipoVehiculoId: dto.tipoVehiculoId,
        placa: dto.placa,
        marca: dto.marca,
        modelo: dto.modelo,
        anio: dto.anio,
        estado: dto.estado ?? EstadoVehiculoLogistica.DISPONIBLE,
        capacidadPesoKg: dto.capacidadPesoKg,
        capacidadVolumenM3: dto.capacidadVolumenM3,
        tipoCombustible: dto.tipoCombustible,
        tieneRefrigeracion: dto.tieneRefrigeracion,
        tieneGPSIntegrado: dto.tieneGPSIntegrado,
        odometroActual: dto.odometroActual ?? 0,
      },
      include: { tipoVehiculo: true },
    });
  }

  async update(id: number, empresaId: number, dto: UpdateVehiculoLogisticaDto) {
    await this.findOne(id, empresaId);

    if (dto.placa) {
      const existing = await this.prisma.vehiculoLogistica.findFirst({
        where: { empresaId, placa: dto.placa, id: { not: id } },
      });
      if (existing)
        throw new ConflictException('Ya existe otro vehículo con esa placa');
    }

    return this.prisma.vehiculoLogistica.update({
      where: { id },
      data: {
        ...(dto.tipoVehiculoId && { tipoVehiculoId: dto.tipoVehiculoId }),
        ...(dto.placa && { placa: dto.placa }),
        ...(dto.marca && { marca: dto.marca }),
        ...(dto.modelo !== undefined && { modelo: dto.modelo }),
        ...(dto.anio !== undefined && { anio: dto.anio }),
        ...(dto.estado && { estado: dto.estado }),
        ...(dto.capacidadPesoKg && { capacidadPesoKg: dto.capacidadPesoKg }),
        ...(dto.capacidadVolumenM3 && {
          capacidadVolumenM3: dto.capacidadVolumenM3,
        }),
        ...(dto.tipoCombustible && { tipoCombustible: dto.tipoCombustible }),
        ...(dto.tieneRefrigeracion !== undefined && {
          tieneRefrigeracion: dto.tieneRefrigeracion,
        }),
        ...(dto.tieneGPSIntegrado !== undefined && {
          tieneGPSIntegrado: dto.tieneGPSIntegrado,
        }),
        ...(dto.odometroActual !== undefined && {
          odometroActual: dto.odometroActual,
        }),
      },
      include: { tipoVehiculo: true },
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.vehiculoLogistica.update({
      where: { id },
      data: { estado: EstadoVehiculoLogistica.FUERA_SERVICIO },
    });
  }
}
