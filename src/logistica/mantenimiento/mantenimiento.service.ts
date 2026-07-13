import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateMantenimientoDto,
  EstadoMantenimientoLogistica,
  TipoMantenimientoLogistica,
} from './dto/create-mantenimiento.dto';
import { UpdateMantenimientoDto } from './dto/update-mantenimiento.dto';

@Injectable()
export class MantenimientoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Verifica que el vehículo exista y pertenezca a la empresa. */
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
      estado?: string;
      tipo?: string;
      vehiculoId?: number;
    },
  ) {
    return this.prisma.mantenimientoLogistica.findMany({
      where: {
        empresaId,
        ...(params?.estado
          ? { estado: params.estado as EstadoMantenimientoLogistica }
          : {}),
        ...(params?.tipo
          ? { tipo: params.tipo as TipoMantenimientoLogistica }
          : {}),
        ...(params?.vehiculoId ? { vehiculoId: params.vehiculoId } : {}),
        ...(params?.search
          ? {
              OR: [
                {
                  descripcion: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
                { taller: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
      },
      orderBy: { fechaProgramada: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const mant = await this.prisma.mantenimientoLogistica.findFirst({
      where: { id, empresaId },
      include: { vehiculo: true },
    });
    if (!mant) throw new NotFoundException('Mantenimiento no encontrado');
    return mant;
  }

  async create(empresaId: number, dto: CreateMantenimientoDto) {
    await this.assertVehiculo(dto.vehiculoId, empresaId);

    const mant = await this.prisma.mantenimientoLogistica.create({
      data: {
        empresaId,
        vehiculoId: dto.vehiculoId,
        tipo: dto.tipo ?? TipoMantenimientoLogistica.PREVENTIVO,
        estado: dto.estado ?? EstadoMantenimientoLogistica.PROGRAMADO,
        descripcion: dto.descripcion,
        taller: dto.taller,
        fechaProgramada: new Date(dto.fechaProgramada),
        fechaRealizado: dto.fechaRealizado
          ? new Date(dto.fechaRealizado)
          : null,
        costo: dto.costo ?? 0,
        odometroKm: dto.odometroKm,
        proximoMantenimientoKm: dto.proximoMantenimientoKm,
        proximoMantenimientoFecha: dto.proximoMantenimientoFecha
          ? new Date(dto.proximoMantenimientoFecha)
          : null,
        evidenciaUrl: dto.evidenciaUrl,
        notas: dto.notas,
      },
      include: {
        vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
      },
    });

    await this.sincronizarVehiculo(mant);
    return mant;
  }

  async update(id: number, empresaId: number, dto: UpdateMantenimientoDto) {
    await this.findOne(id, empresaId);
    if (dto.vehiculoId) await this.assertVehiculo(dto.vehiculoId, empresaId);

    const mant = await this.prisma.mantenimientoLogistica.update({
      where: { id },
      data: {
        ...(dto.vehiculoId && { vehiculoId: dto.vehiculoId }),
        ...(dto.tipo && { tipo: dto.tipo }),
        ...(dto.estado && { estado: dto.estado }),
        ...(dto.descripcion && { descripcion: dto.descripcion }),
        ...(dto.taller !== undefined && { taller: dto.taller }),
        ...(dto.fechaProgramada && {
          fechaProgramada: new Date(dto.fechaProgramada),
        }),
        ...(dto.fechaRealizado !== undefined && {
          fechaRealizado: dto.fechaRealizado
            ? new Date(dto.fechaRealizado)
            : null,
        }),
        ...(dto.costo !== undefined && { costo: dto.costo }),
        ...(dto.odometroKm !== undefined && { odometroKm: dto.odometroKm }),
        ...(dto.proximoMantenimientoKm !== undefined && {
          proximoMantenimientoKm: dto.proximoMantenimientoKm,
        }),
        ...(dto.proximoMantenimientoFecha !== undefined && {
          proximoMantenimientoFecha: dto.proximoMantenimientoFecha
            ? new Date(dto.proximoMantenimientoFecha)
            : null,
        }),
        ...(dto.evidenciaUrl !== undefined && {
          evidenciaUrl: dto.evidenciaUrl,
        }),
        ...(dto.notas !== undefined && { notas: dto.notas }),
      },
      include: {
        vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
      },
    });

    await this.sincronizarVehiculo(mant);
    return mant;
  }

  /** Baja lógica: marca el mantenimiento como CANCELADO. */
  async remove(id: number, empresaId: number) {
    await this.findOne(id, empresaId);
    return this.prisma.mantenimientoLogistica.update({
      where: { id },
      data: { estado: EstadoMantenimientoLogistica.CANCELADO },
    });
  }

  /**
   * Al completar un mantenimiento con odómetro, sincroniza el odómetro del
   * vehículo (solo si es mayor) y su próximo mantenimiento programado.
   */
  private async sincronizarVehiculo(mant: {
    estado: string;
    vehiculoId: number;
    odometroKm: number | null;
    proximoMantenimientoKm: number | null;
  }) {
    if (mant.estado !== EstadoMantenimientoLogistica.COMPLETADO) return;

    const data: { odometroActual?: number; proximoMantenimiento?: number } = {};
    if (mant.odometroKm != null) {
      const vehiculo = await this.prisma.vehiculoLogistica.findUnique({
        where: { id: mant.vehiculoId },
        select: { odometroActual: true },
      });
      if (vehiculo && mant.odometroKm > vehiculo.odometroActual) {
        data.odometroActual = mant.odometroKm;
      }
    }
    if (mant.proximoMantenimientoKm != null) {
      data.proximoMantenimiento = mant.proximoMantenimientoKm;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.vehiculoLogistica.update({
        where: { id: mant.vehiculoId },
        data,
      });
    }
  }

  /** Métricas para el encabezado del módulo. */
  async resumen(empresaId: number) {
    const [porEstado, agregados, proximos] = await Promise.all([
      this.prisma.mantenimientoLogistica.groupBy({
        by: ['estado'],
        where: { empresaId },
        _count: { _all: true },
      }),
      this.prisma.mantenimientoLogistica.aggregate({
        where: {
          empresaId,
          estado: EstadoMantenimientoLogistica.COMPLETADO,
        },
        _sum: { costo: true },
      }),
      this.prisma.mantenimientoLogistica.count({
        where: {
          empresaId,
          estado: {
            in: [
              EstadoMantenimientoLogistica.PROGRAMADO,
              EstadoMantenimientoLogistica.EN_PROCESO,
            ],
          },
        },
      }),
    ]);

    const conteos = porEstado.reduce<Record<string, number>>((acc, r) => {
      acc[r.estado] = r._count._all;
      return acc;
    }, {});

    return {
      programados: conteos[EstadoMantenimientoLogistica.PROGRAMADO] ?? 0,
      enProceso: conteos[EstadoMantenimientoLogistica.EN_PROCESO] ?? 0,
      completados: conteos[EstadoMantenimientoLogistica.COMPLETADO] ?? 0,
      cancelados: conteos[EstadoMantenimientoLogistica.CANCELADO] ?? 0,
      pendientes: proximos,
      costoTotalCompletados: Number(agregados._sum.costo ?? 0),
    };
  }
}
