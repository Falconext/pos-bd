import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePedidoLogisticaDto } from './dto/create-pedido.dto';
import {
  UpdateEstadoPedidoDto,
  EstadoPedidoLogistica,
} from './dto/update-estado-pedido.dto';

@Injectable()
export class PedidoLogisticaService {
  constructor(private readonly prisma: PrismaService) {}

  private generarCodigoTracking(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'TRK-';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async findAll(
    empresaId: number,
    params?: { search?: string; estado?: string },
  ) {
    return this.prisma.pedidoLogistica.findMany({
      where: {
        empresaId,
        ...(params?.estado
          ? { estado: params.estado as EstadoPedidoLogistica }
          : {}),
        ...(params?.search
          ? {
              OR: [
                {
                  codigoTracking: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
                {
                  nroOrdenExterna: {
                    contains: params.search,
                    mode: 'insensitive',
                  },
                },
                {
                  cliente: {
                    nombre: { contains: params.search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        cliente: true,
        direccionEntrega: true,
        items: true,
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const pedido = await this.prisma.pedidoLogistica.findFirst({
      where: { id, empresaId },
      include: {
        cliente: true,
        direccionEntrega: true,
        items: true,
        historialEstados: {
          orderBy: { creadoEn: 'desc' },
          include: { usuario: { select: { nombre: true } } },
        },
      },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido;
  }

  async create(empresaId: number, dto: CreatePedidoLogisticaDto) {
    // Validar cliente y direccion
    const cliente = await this.prisma.clienteLogistica.findFirst({
      where: { id: dto.clienteId, empresaId },
    });
    if (!cliente) throw new BadRequestException('Cliente no encontrado');

    const direccion = await this.prisma.direccionEntregaLogistica.findFirst({
      where: {
        id: dto.direccionEntregaId,
        empresaId,
        clienteId: dto.clienteId,
      },
    });
    if (!direccion)
      throw new BadRequestException(
        'Dirección de entrega no válida para el cliente',
      );

    // Calcular totales
    let pesoTotal = 0;
    let volumenTotal = 0;

    for (const item of dto.items) {
      pesoTotal += (item.pesoUnitarioKg || 0) * item.cantidad;
      volumenTotal += (item.volumenUnitarioM3 || 0) * item.cantidad;
    }

    const codigoTracking = this.generarCodigoTracking();

    return this.prisma.pedidoLogistica.create({
      data: {
        empresaId,
        codigoTracking,
        clienteId: dto.clienteId,
        direccionEntregaId: dto.direccionEntregaId,
        nroOrdenExterna: dto.nroOrdenExterna,
        fechaSolicitada: dto.fechaSolicitada
          ? new Date(dto.fechaSolicitada)
          : null,
        ventanaInicio: dto.ventanaInicio,
        ventanaFin: dto.ventanaFin,
        prioridad: dto.prioridad ?? 1,
        esUrgente: dto.esUrgente ?? false,
        requiereFirma: dto.requiereFirma ?? true,
        requiereFoto: dto.requiereFoto ?? false,
        cobroContraEntrega: dto.cobroContraEntrega ?? 0,
        pesoTotalKg: pesoTotal,
        volumenTotalM3: volumenTotal,
        nroBultos: dto.items.reduce((acc, item) => acc + item.cantidad, 0),
        notasCliente: dto.notasCliente,
        notasInternas: dto.notasInternas,
        items: {
          create: dto.items.map((i) => ({
            sku: i.sku,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            pesoUnitarioKg: i.pesoUnitarioKg,
            volumenUnitarioM3: i.volumenUnitarioM3,
            valorDeclarado: i.valorDeclarado,
          })),
        },
        historialEstados: {
          create: {
            estadoNuevo: EstadoPedidoLogistica.PENDIENTE,
            motivo: 'Pedido creado',
          },
        },
      },
      include: {
        items: true,
      },
    });
  }

  async updateEstado(
    id: number,
    empresaId: number,
    usuarioId: number,
    dto: UpdateEstadoPedidoDto,
  ) {
    const pedido = await this.findOne(id, empresaId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pedidoLogistica.update({
        where: { id },
        data: { estado: dto.estado },
      });

      await tx.historialEstadoPedidoLogistica.create({
        data: {
          pedidoId: id,
          estadoAnterior: pedido.estado as EstadoPedidoLogistica,
          estadoNuevo: dto.estado,
          motivo: dto.motivo,
          notas: dto.notas,
          lat: dto.lat,
          lng: dto.lng,
          usuarioId: usuarioId,
        },
      });

      return updated;
    });
  }
}
