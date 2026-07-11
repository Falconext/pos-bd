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
import { CreateTipoVehiculoDto } from './dto/create-tipo-vehiculo.dto';

/** Tipos de flota por defecto (se siembran la primera vez que la empresa consulta). */
const TIPOS_DEFAULT = [
  { nombre: 'Moto', capacidadPesoKg: 30, capacidadVolumenM3: 0.2 },
  { nombre: 'Auto', capacidadPesoKg: 200, capacidadVolumenM3: 0.5 },
  { nombre: 'Camioneta', capacidadPesoKg: 800, capacidadVolumenM3: 2.5 },
  { nombre: 'Furgón', capacidadPesoKg: 1500, capacidadVolumenM3: 8 },
  { nombre: 'Camión', capacidadPesoKg: 5000, capacidadVolumenM3: 30 },
];

@Injectable()
export class VehiculoLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista los tipos de vehículo de la empresa. Si no tiene ninguno, siembra los
   * tipos por defecto (Moto/Auto/Camioneta/Furgón/Camión) — así el módulo de
   * flota es usable de inmediato, sin migración ni seed manual.
   */
  async listarTipos(empresaId: number) {
    const existentes = await this.prisma.tipoVehiculoLogistica.findMany({
      where: { empresaId },
      orderBy: { capacidadPesoKg: 'asc' },
    });
    if (existentes.length > 0) return existentes;
    await this.prisma.tipoVehiculoLogistica.createMany({
      data: TIPOS_DEFAULT.map((t) => ({ ...t, empresaId })),
    });
    return this.prisma.tipoVehiculoLogistica.findMany({
      where: { empresaId },
      orderBy: { capacidadPesoKg: 'asc' },
    });
  }

  /** Crea un tipo de vehículo propio. */
  async crearTipo(empresaId: number, dto: CreateTipoVehiculoDto) {
    return this.prisma.tipoVehiculoLogistica.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        capacidadPesoKg: dto.capacidadPesoKg,
        capacidadVolumenM3: dto.capacidadVolumenM3,
        costoPromedioKm: dto.costoPromedioKm,
      },
    });
  }

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
