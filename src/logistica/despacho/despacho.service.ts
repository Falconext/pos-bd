import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EstadoPedidoLogistica } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../integraciones/webhooks/webhooks.service';
import {
  CreateDespachoLogisticaDto,
  EstadoDespachoLogistica,
  UpdateEstadoDespachoDto,
} from './dto/create-despacho.dto';

/** Estado del despacho → estado que toman sus pedidos asignados (no-terminales). */
const DESPACHO_A_PEDIDO: Partial<Record<string, EstadoPedidoLogistica>> = {
  APROBADO: EstadoPedidoLogistica.ASIGNADO,
  CARGANDO: EstadoPedidoLogistica.RECOGIDO,
  LISTO: EstadoPedidoLogistica.RECOGIDO,
  EN_CURSO: EstadoPedidoLogistica.EN_TRANSITO,
};
/** Estado de pedido → evento de webhook (order.*). */
const PEDIDO_A_EVENTO: Partial<Record<EstadoPedidoLogistica, string>> = {
  ASIGNADO: 'order.assigned',
  RECOGIDO: 'order.picked_up',
  EN_TRANSITO: 'order.in_transit',
  ENTREGADO: 'order.delivered',
  FALLIDO: 'order.failed',
  DEVUELTO: 'order.returned',
};
const TERMINALES: EstadoPedidoLogistica[] = [
  EstadoPedidoLogistica.ENTREGADO,
  EstadoPedidoLogistica.ENTREGA_PARCIAL,
  EstadoPedidoLogistica.FALLIDO,
  EstadoPedidoLogistica.DEVUELTO,
  EstadoPedidoLogistica.CANCELADO,
];

@Injectable()
export class DespachoLogisticaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

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

    const updated = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.despachoLogistica.update({
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

      return upd;
    });

    // Propaga el estado a los pedidos asignados (no-terminales) + dispara sus
    // webhooks. Así, gestionar por despachos mantiene el estado de cada pedido
    // sincronizado y notifica al integrador — igual que el flujo directo.
    const estadoPedido = DESPACHO_A_PEDIDO[dto.estado];
    if (estadoPedido) {
      const asignaciones = await this.prisma.despachoPedidoLogistica.findMany({
        where: { despachoId: id },
        include: {
          pedido: { select: { id: true, codigoTracking: true, estado: true } },
        },
      });
      for (const a of asignaciones) {
        const p = a.pedido;
        if (!p || TERMINALES.includes(p.estado) || p.estado === estadoPedido) {
          continue;
        }
        await this.prisma.$transaction(async (tx) => {
          await tx.pedidoLogistica.update({
            where: { id: p.id },
            data: { estado: estadoPedido },
          });
          await tx.historialEstadoPedidoLogistica.create({
            data: {
              pedidoId: p.id,
              estadoAnterior: p.estado,
              estadoNuevo: estadoPedido,
              motivo: `Despacho ${despacho.codigo}`,
              usuarioId,
            },
          });
        });
        const evento = PEDIDO_A_EVENTO[estadoPedido];
        if (evento) {
          void this.webhooks
            .dispatchEvent(empresaId, evento, {
              id: p.id,
              tracking_code: p.codigoTracking,
              status: estadoPedido,
            })
            .catch(() => undefined);
        }
      }
    }

    return updated;
  }
}
