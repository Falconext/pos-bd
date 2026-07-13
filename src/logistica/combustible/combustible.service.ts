import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCombustibleDto,
  TipoCombustibleLogistica,
} from './dto/create-combustible.dto';
import { UpdateCombustibleDto } from './dto/update-combustible.dto';

@Injectable()
export class CombustibleService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertVehiculo(vehiculoId: number, empresaId: number) {
    const vehiculo = await this.prisma.vehiculoLogistica.findFirst({
      where: { id: vehiculoId, empresaId },
    });
    if (!vehiculo)
      throw new BadRequestException('El vehículo indicado no existe');
    return vehiculo;
  }

  /** Deriva costoPorLitro si no se envía. */
  private derivarCostoPorLitro(dto: {
    costoPorLitro?: number;
    costoTotal?: number;
    cantidadLitros?: number;
  }) {
    if (dto.costoPorLitro != null) return dto.costoPorLitro;
    if (dto.costoTotal != null && dto.cantidadLitros)
      return Number((dto.costoTotal / dto.cantidadLitros).toFixed(2));
    return undefined;
  }

  async findAll(
    empresaId: number,
    params?: { search?: string; vehiculoId?: number },
  ) {
    return this.prisma.combustibleLogistica.findMany({
      where: {
        empresaId,
        ...(params?.vehiculoId ? { vehiculoId: params.vehiculoId } : {}),
        ...(params?.search
          ? {
              OR: [
                { estacion: { contains: params.search, mode: 'insensitive' } },
                {
                  numeroComprobante: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        vehiculo: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
      },
      orderBy: { fecha: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const reg = await this.prisma.combustibleLogistica.findFirst({
      where: { id, empresaId },
      include: { vehiculo: true },
    });
    if (!reg) throw new NotFoundException('Registro de combustible no encontrado');
    return reg;
  }

  async create(empresaId: number, dto: CreateCombustibleDto) {
    await this.assertVehiculo(dto.vehiculoId, empresaId);
    const reg = await this.prisma.combustibleLogistica.create({
      data: {
        empresaId,
        vehiculoId: dto.vehiculoId,
        fecha: new Date(dto.fecha),
        tipoCombustible:
          dto.tipoCombustible ?? TipoCombustibleLogistica.GASOLINA,
        cantidadLitros: dto.cantidadLitros,
        costoTotal: dto.costoTotal,
        costoPorLitro: this.derivarCostoPorLitro(dto),
        odometroKm: dto.odometroKm,
        estacion: dto.estacion,
        numeroComprobante: dto.numeroComprobante,
        evidenciaUrl: dto.evidenciaUrl,
        notas: dto.notas,
      },
      include: {
        vehiculo: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
      },
    });
    await this.sincronizarOdometro(reg.vehiculoId, dto.odometroKm);
    return reg;
  }

  async update(id: number, empresaId: number, dto: UpdateCombustibleDto) {
    await this.findOne(id, empresaId);
    if (dto.vehiculoId) await this.assertVehiculo(dto.vehiculoId, empresaId);
    const reg = await this.prisma.combustibleLogistica.update({
      where: { id },
      data: {
        ...(dto.vehiculoId && { vehiculoId: dto.vehiculoId }),
        ...(dto.fecha && { fecha: new Date(dto.fecha) }),
        ...(dto.tipoCombustible && { tipoCombustible: dto.tipoCombustible }),
        ...(dto.cantidadLitros !== undefined && {
          cantidadLitros: dto.cantidadLitros,
        }),
        ...(dto.costoTotal !== undefined && { costoTotal: dto.costoTotal }),
        ...(dto.costoPorLitro !== undefined && {
          costoPorLitro: dto.costoPorLitro,
        }),
        ...(dto.odometroKm !== undefined && { odometroKm: dto.odometroKm }),
        ...(dto.estacion !== undefined && { estacion: dto.estacion }),
        ...(dto.numeroComprobante !== undefined && {
          numeroComprobante: dto.numeroComprobante,
        }),
        ...(dto.evidenciaUrl !== undefined && {
          evidenciaUrl: dto.evidenciaUrl,
        }),
        ...(dto.notas !== undefined && { notas: dto.notas }),
      },
      include: {
        vehiculo: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
      },
    });
    if (dto.odometroKm !== undefined)
      await this.sincronizarOdometro(reg.vehiculoId, dto.odometroKm);
    return reg;
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.combustibleLogistica.delete({ where: { id } });
  }

  /** Actualiza el odómetro del vehículo si la carga registra uno mayor. */
  private async sincronizarOdometro(vehiculoId: number, odometroKm?: number) {
    if (odometroKm == null) return;
    const vehiculo = await this.prisma.vehiculoLogistica.findUnique({
      where: { id: vehiculoId },
      select: { odometroActual: true },
    });
    if (vehiculo && odometroKm > vehiculo.odometroActual) {
      await this.prisma.vehiculoLogistica.update({
        where: { id: vehiculoId },
        data: { odometroActual: odometroKm },
      });
    }
  }

  /** Métricas: gasto total y litros del mes en curso. */
  async resumen(empresaId: number) {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [totalMes, totalGeneral] = await Promise.all([
      this.prisma.combustibleLogistica.aggregate({
        where: { empresaId, fecha: { gte: inicioMes } },
        _sum: { costoTotal: true, cantidadLitros: true },
        _count: { _all: true },
      }),
      this.prisma.combustibleLogistica.aggregate({
        where: { empresaId },
        _sum: { costoTotal: true },
      }),
    ]);

    return {
      registrosMes: totalMes._count._all,
      gastoMes: Number(totalMes._sum.costoTotal ?? 0),
      litrosMes: Number(totalMes._sum.cantidadLitros ?? 0),
      gastoTotal: Number(totalGeneral._sum.costoTotal ?? 0),
    };
  }
}
