import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDespachoLogisticaDto,
  EstadoDespachoLogistica,
  UpdateEstadoDespachoDto,
} from './dto/create-despacho.dto';

@Injectable()
export class DespachoLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  private generarCodigoDespacho(): string {
    const chars = '0123456789';
    let result = 'DESP-';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async findAll(empresaId: number, params?: { estado?: string }) {
    return this.prisma.despachoLogistica.findMany({
      where: {
        empresaId,
        ...(params?.estado
          ? { estado: params.estado as EstadoDespachoLogistica }
          : {}),
      },
      include: {
        conductor: true,
        vehiculo: true,
        almacenOrigen: true,
        _count: {
          select: { pedidos: true },
        },
      },
      orderBy: { fechaProgramada: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const despacho = await this.prisma.despachoLogistica.findFirst({
      where: { id, empresaId },
      include: {
        conductor: true,
        vehiculo: true,
        almacenOrigen: true,
        almacenDestino: true,
        pedidos: {
          include: {
            pedido: {
              include: { cliente: true, direccionEntrega: true },
            },
          },
          orderBy: { ordenSecuencia: 'asc' },
        },
        rutaOptimizada: true,
        historialEstados: {
          orderBy: { creadoEn: 'desc' },
          include: { usuario: { select: { nombre: true } } },
        },
      },
    });
    if (!despacho) throw new NotFoundException('Despacho no encontrado');
    return despacho;
  }

  async create(empresaId: number, dto: CreateDespachoLogisticaDto) {
    const codigo = this.generarCodigoDespacho();

    return this.prisma.despachoLogistica.create({
      data: {
        empresaId,
        codigo,
        nombre: dto.nombre,
        almacenOrigenId: dto.almacenOrigenId,
        almacenDestinoId: dto.almacenDestinoId,
        conductorId: dto.conductorId,
        vehiculoId: dto.vehiculoId,
        fechaProgramada: new Date(dto.fechaProgramada),
        horaInicioProgramada: dto.horaInicioProgramada,
        notas: dto.notas,
        estado: EstadoDespachoLogistica.BORRADOR,
        pedidos: dto.pedidoIds
          ? {
              create: dto.pedidoIds.map((pedidoId, index) => ({
                pedidoId,
                ordenSecuencia: index + 1,
              })),
            }
          : undefined,
      },
      include: {
        pedidos: true,
      },
    });
  }

  async updateEstado(
    id: number,
    empresaId: number,
    usuarioId: number,
    dto: UpdateEstadoDespachoDto,
  ) {
    const despacho = await this.findOne(id, empresaId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.despachoLogistica.update({
        where: { id },
        data: { estado: dto.estado },
      });

      await tx.historialEstadoDespachoLogistica.create({
        data: {
          despachoId: id,
          estadoAnterior: despacho.estado as EstadoDespachoLogistica,
          estadoNuevo: dto.estado,
          motivo: dto.motivo,
          usuarioId: usuarioId,
        },
      });

      // Si se aprueba o inicia, podríamos cambiar el estado de los pedidos asociados aquí.
      // (Simplificado para el MVP)

      return updated;
    });
  }
}
