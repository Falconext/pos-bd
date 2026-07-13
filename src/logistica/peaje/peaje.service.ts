import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePeajeDto,
  TipoPeajeLogistica,
  EstadoPeajeLogistica,
} from './dto/create-peaje.dto';
import { UpdatePeajeDto } from './dto/update-peaje.dto';

@Injectable()
export class PeajeService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertVehiculo(vehiculoId: number, empresaId: number) {
    const vehiculo = await this.prisma.vehiculoLogistica.findFirst({
      where: { id: vehiculoId, empresaId },
    });
    if (!vehiculo)
      throw new BadRequestException('El vehículo indicado no existe');
    return vehiculo;
  }

  async findAll(
    empresaId: number,
    params?: {
      search?: string;
      tipo?: string;
      estado?: string;
      vehiculoId?: number;
    },
  ) {
    return this.prisma.peajeLogistica.findMany({
      where: {
        empresaId,
        ...(params?.tipo
          ? { tipo: params.tipo as TipoPeajeLogistica }
          : {}),
        ...(params?.estado
          ? { estado: params.estado as EstadoPeajeLogistica }
          : {}),
        ...(params?.vehiculoId ? { vehiculoId: params.vehiculoId } : {}),
        ...(params?.search
          ? {
              OR: [
                { lugar: { contains: params.search, mode: 'insensitive' } },
                {
                  descripcion: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
                { placa: { contains: params.search, mode: 'insensitive' } },
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
    const reg = await this.prisma.peajeLogistica.findFirst({
      where: { id, empresaId },
      include: { vehiculo: true },
    });
    if (!reg) throw new NotFoundException('Registro no encontrado');
    return reg;
  }

  async create(empresaId: number, dto: CreatePeajeDto) {
    if (dto.vehiculoId) await this.assertVehiculo(dto.vehiculoId, empresaId);
    return this.prisma.peajeLogistica.create({
      data: {
        empresaId,
        vehiculoId: dto.vehiculoId,
        tipo: dto.tipo ?? TipoPeajeLogistica.PEAJE,
        estado: dto.estado ?? EstadoPeajeLogistica.PENDIENTE,
        fecha: new Date(dto.fecha),
        monto: dto.monto,
        lugar: dto.lugar,
        descripcion: dto.descripcion,
        placa: dto.placa,
        comprobanteUrl: dto.comprobanteUrl,
        reciboPagoUrl: dto.reciboPagoUrl,
        notas: dto.notas,
      },
      include: {
        vehiculo: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
      },
    });
  }

  async update(id: number, empresaId: number, dto: UpdatePeajeDto) {
    await this.findOne(id, empresaId);
    if (dto.vehiculoId) await this.assertVehiculo(dto.vehiculoId, empresaId);
    return this.prisma.peajeLogistica.update({
      where: { id },
      data: {
        ...(dto.vehiculoId !== undefined && { vehiculoId: dto.vehiculoId }),
        ...(dto.tipo && { tipo: dto.tipo }),
        ...(dto.estado && { estado: dto.estado }),
        ...(dto.fecha && { fecha: new Date(dto.fecha) }),
        ...(dto.monto !== undefined && { monto: dto.monto }),
        ...(dto.lugar !== undefined && { lugar: dto.lugar }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.placa !== undefined && { placa: dto.placa }),
        ...(dto.comprobanteUrl !== undefined && {
          comprobanteUrl: dto.comprobanteUrl,
        }),
        ...(dto.reciboPagoUrl !== undefined && {
          reciboPagoUrl: dto.reciboPagoUrl,
        }),
        ...(dto.notas !== undefined && { notas: dto.notas }),
      },
      include: {
        vehiculo: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
      },
    });
  }

  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.peajeLogistica.delete({ where: { id } });
  }

  /** Métricas: pendientes y montos por estado. */
  async resumen(empresaId: number) {
    const [porEstado, pendientes] = await Promise.all([
      this.prisma.peajeLogistica.groupBy({
        by: ['estado'],
        where: { empresaId },
        _sum: { monto: true },
        _count: { _all: true },
      }),
      this.prisma.peajeLogistica.aggregate({
        where: { empresaId, estado: EstadoPeajeLogistica.PENDIENTE },
        _sum: { monto: true },
        _count: { _all: true },
      }),
    ]);

    const montoPorEstado = porEstado.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.estado] = Number(r._sum.monto ?? 0);
        return acc;
      },
      {},
    );

    return {
      pendientesCount: pendientes._count._all,
      montoPendiente: Number(pendientes._sum.monto ?? 0),
      montoPagado: montoPorEstado[EstadoPeajeLogistica.PAGADO] ?? 0,
      montoTotal: porEstado.reduce((s, r) => s + Number(r._sum.monto ?? 0), 0),
    };
  }
}
