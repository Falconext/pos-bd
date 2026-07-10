import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class ExternalOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  async createOrder(payload: any) {
    // Implement order creation via external API
    return { status: 'created' };
  }

  async createBulkOrders(payload: any[]) {
    // Implement bulk order creation
    return { status: 'created_bulk', count: payload.length };
  }

  async getOrders(query: any) {
    // Fetch external orders
    return [];
  }

  async getOrderStatus(id: string) {
    // Get order status
    return { status: 'PENDIENTE' };
  }

  async cancelOrder(id: string) {
    // Cancel external order
    return { status: 'cancelled' };
  }

  async getTracking(id: string) {
    // Get tracking info
    return { tracking: [] };
  }

  /**
   * Prueba de entrega (fachada `ProofOfDelivery`) de un pedido entregado.
   *
   * Resuelve el pedido por `codigoTracking` o por id numérico de Falconext, toma
   * la última `PruebaEntregaLogistica` registrada y la mapea a la fachada inglés.
   * Si el pedido no existe o aún no tiene prueba de entrega, responde 404.
   */
  async getProof(id: string) {
    const numericId = /^\d+$/.test(id) ? Number(id) : undefined;
    const pedido = await this.prisma.pedidoLogistica.findFirst({
      where: {
        OR: [
          { codigoTracking: id },
          ...(numericId !== undefined ? [{ id: numericId }] : []),
        ],
      },
      include: {
        pruebasEntrega: { orderBy: { creadoEn: 'desc' }, take: 1 },
      },
    });

    if (!pedido) {
      throw new NotFoundException('Orden no encontrada.');
    }

    const prueba = pedido.pruebasEntrega[0];
    if (!prueba) {
      throw new NotFoundException(
        'La orden aún no tiene una prueba de entrega registrada.',
      );
    }

    // Mapeo interno (español) → fachada pública (inglés / snake_case).
    return {
      receiver_name: prueba.nombreReceptor ?? undefined,
      receiver_document: prueba.dniReceptor ?? undefined,
      relationship: prueba.parentesco ?? undefined,
      signature_url: prueba.firmaUrl ?? undefined,
      photo_urls: prueba.fotosUrls ?? [],
      collected_amount:
        prueba.montoCobrado != null ? Number(prueba.montoCobrado) : undefined,
      payment_method: prueba.metodoPago ?? undefined,
      delivered_at: prueba.creadoEn?.toISOString(),
    };
  }
}
