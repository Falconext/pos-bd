import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import {
  EstadoPedidoLogistica,
  OrigenPedidoLogistica,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';

/** EstadoPedidoLogistica (interno, español) → OrderStatus (fachada, inglés). */
const ESTADO_A_STATUS: Record<EstadoPedidoLogistica, string> = {
  PENDIENTE: 'pending',
  VALIDADO: 'validated',
  ASIGNADO: 'assigned',
  LISTO_RECOGER: 'ready_for_pickup',
  RECOGIDO: 'picked_up',
  EN_TRANSITO: 'in_transit',
  LLEGANDO: 'arriving',
  EN_UBICACION: 'at_location',
  ENTREGADO: 'delivered',
  ENTREGA_PARCIAL: 'partially_delivered',
  FALLIDO: 'failed',
  DEVUELTO: 'returned',
  REPROGRAMADO: 'rescheduled',
  CANCELADO: 'cancelled',
};
/** OrderStatus (inglés) → EstadoPedidoLogistica (interno). Para filtros. */
const STATUS_A_ESTADO: Record<string, EstadoPedidoLogistica> = Object.entries(
  ESTADO_A_STATUS,
).reduce(
  (acc, [k, v]) => ({ ...acc, [v]: k as EstadoPedidoLogistica }),
  {} as Record<string, EstadoPedidoLogistica>,
);

const ORIGEN_A_SOURCE: Record<OrigenPedidoLogistica, string> = {
  MANUAL: 'manual',
  EXCEL: 'excel',
  API: 'api',
  WEBHOOK: 'webhook',
  ECOMMERCE: 'ecommerce',
  FALCONEXT_ERP: 'falconext_erp',
  FALCONEXT: 'falconext',
};

const PEDIDO_INCLUDE = {
  cliente: true,
  direccionEntrega: true,
  items: true,
} satisfies Prisma.PedidoLogisticaInclude;

type PedidoConRelaciones = Prisma.PedidoLogisticaGetPayload<{
  include: typeof PEDIDO_INCLUDE;
}>;

const num = (d: Prisma.Decimal | number | null | undefined) =>
  d == null ? undefined : Number(d);

@Injectable()
export class ExternalOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  private generarCodigoTracking(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = 'FLX-';
    for (let i = 0; i < 8; i++)
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  /** Resuelve `ord_123`, `123` o el `tracking_code` a un WHERE scopeado por empresa. */
  private whereByPublicId(
    empresaId: number,
    id: string,
  ): Prisma.PedidoLogisticaWhereInput {
    const raw = id.startsWith('ord_') ? id.slice(4) : id;
    const numericId = /^\d+$/.test(raw) ? Number(raw) : undefined;
    return {
      empresaId,
      OR: [
        { codigoTracking: id },
        ...(numericId !== undefined ? [{ id: numericId }] : []),
      ],
    };
  }

  /** PedidoLogistica (interno) → Order (fachada inglés). */
  private toOrder(p: PedidoConRelaciones) {
    return {
      id: `ord_${p.id}`,
      object: 'order',
      tracking_code: p.codigoTracking,
      external_order_id: p.nroOrdenExterna ?? undefined,
      source: ORIGEN_A_SOURCE[p.origen] ?? 'api',
      status: ESTADO_A_STATUS[p.estado] ?? 'pending',
      customer: p.cliente
        ? {
            name: p.cliente.nombre,
            document_type: p.cliente.tipoDocumento ?? undefined,
            document_number: p.cliente.nroDocumento ?? undefined,
            email: p.cliente.email ?? undefined,
            phone: p.cliente.celular ?? undefined,
            whatsapp: p.cliente.whatsapp ?? undefined,
          }
        : undefined,
      delivery_address: p.direccionEntrega
        ? {
            label: p.direccionEntrega.etiqueta ?? undefined,
            address: p.direccionEntrega.direccion,
            district: p.direccionEntrega.distrito ?? undefined,
            city: p.direccionEntrega.ciudad ?? undefined,
            department: p.direccionEntrega.departamento ?? undefined,
            lat: num(p.direccionEntrega.lat),
            lng: num(p.direccionEntrega.lng),
            reference: p.direccionEntrega.referencia ?? undefined,
            access_notes: p.direccionEntrega.notasAcceso ?? undefined,
          }
        : undefined,
      items: (p.items ?? []).map((i) => ({
        sku: i.sku ?? undefined,
        description: i.descripcion,
        quantity: i.cantidad,
        weight_kg: num(i.pesoUnitarioKg),
        declared_value: num(i.valorDeclarado),
      })),
      weight_kg: num(p.pesoTotalKg),
      packages: p.nroBultos,
      cash_on_delivery: num(p.cobroContraEntrega),
      shipping_cost: num(p.costoEnvio),
      created_at: p.creadoEn.toISOString(),
      updated_at: p.actualizadoEn.toISOString(),
    };
  }

  // ── Crear ────────────────────────────────────────────────────────────────
  async createOrder(empresaId: number, payload: any) {
    const customer = payload?.customer;
    const address = payload?.delivery_address;
    if (!customer?.name) {
      throw new UnprocessableEntityException('customer.name es requerido.');
    }
    if (!address?.address) {
      throw new UnprocessableEntityException(
        'delivery_address.address es requerido.',
      );
    }

    // Cliente: reutiliza por documento si existe; si no, lo crea.
    let cliente =
      customer.document_number
        ? await this.prisma.clienteLogistica.findFirst({
            where: { empresaId, nroDocumento: String(customer.document_number) },
          })
        : null;
    if (!cliente) {
      cliente = await this.prisma.clienteLogistica.create({
        data: {
          empresaId,
          nombre: String(customer.name),
          tipoDocumento: customer.document_type ?? null,
          nroDocumento: customer.document_number
            ? String(customer.document_number)
            : null,
          email: customer.email ?? null,
          celular: customer.phone ?? null,
          whatsapp: customer.whatsapp ?? null,
        },
      });
    }

    // Dirección: se crea una por orden.
    const direccion = await this.prisma.direccionEntregaLogistica.create({
      data: {
        empresaId,
        clienteId: cliente.id,
        etiqueta: address.label ?? null,
        direccion: String(address.address),
        distrito: address.district ?? null,
        ciudad: address.city ?? null,
        departamento: address.department ?? null,
        lat: address.lat != null ? new Prisma.Decimal(address.lat) : null,
        lng: address.lng != null ? new Prisma.Decimal(address.lng) : null,
        referencia: address.reference ?? null,
        notasAcceso: address.access_notes ?? null,
      },
    });

    const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
    let pesoTotal = 0;
    let bultos = 0;
    for (const it of items) {
      const q = Number(it?.quantity ?? 1) || 1;
      pesoTotal += (Number(it?.weight_kg) || 0) * q;
      bultos += q;
    }

    const tw = payload?.time_window ?? {};
    const pedido = await this.prisma.pedidoLogistica.create({
      data: {
        empresaId,
        codigoTracking: this.generarCodigoTracking(),
        origen: OrigenPedidoLogistica.API,
        nroOrdenExterna: payload?.external_order_id ?? null,
        externalOrderId: payload?.external_order_id ?? null,
        externalSystem: payload?.source ?? 'api',
        externalPayload: payload?.metadata ?? undefined,
        clienteId: cliente.id,
        direccionEntregaId: direccion.id,
        fechaSolicitada: payload?.requested_date
          ? new Date(payload.requested_date)
          : null,
        ventanaInicio: tw?.start ?? null,
        ventanaFin: tw?.end ?? null,
        prioridad: Number(payload?.priority) || 1,
        esUrgente: !!payload?.is_urgent,
        requiereFirma: payload?.requires_signature ?? true,
        requiereFoto: !!payload?.requires_photo,
        cobroContraEntrega: payload?.cash_on_delivery
          ? new Prisma.Decimal(payload.cash_on_delivery)
          : 0,
        pesoTotalKg: pesoTotal,
        nroBultos: bultos || 1,
        notasCliente: payload?.customer_notes ?? null,
        items: {
          create: items.map((it) => ({
            sku: it?.sku ?? null,
            descripcion: String(it?.description ?? 'Item'),
            cantidad: Number(it?.quantity ?? 1) || 1,
            pesoUnitarioKg:
              it?.weight_kg != null ? new Prisma.Decimal(it.weight_kg) : null,
            valorDeclarado:
              it?.declared_value != null
                ? new Prisma.Decimal(it.declared_value)
                : null,
          })),
        },
        historialEstados: {
          create: { estadoNuevo: EstadoPedidoLogistica.PENDIENTE, motivo: 'Orden creada vía API' },
        },
      },
      include: PEDIDO_INCLUDE,
    });

    const order = this.toOrder(pedido);
    void this.webhooks
      .dispatchEvent(empresaId, 'order.created', order)
      .catch(() => undefined);
    return order;
  }

  async createBulkOrders(empresaId: number, payload: any[]) {
    const arr = Array.isArray(payload) ? payload : [];
    const data: Array<Awaited<ReturnType<typeof this.createOrder>>> = [];
    for (const p of arr) data.push(await this.createOrder(empresaId, p));
    return { object: 'list', data, has_more: false };
  }

  // ── Listar / obtener ───────────────────────────────────────────────────────
  async getOrders(empresaId: number, query: any) {
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const estado = query?.status
      ? STATUS_A_ESTADO[String(query.status)]
      : undefined;
    const rows = await this.prisma.pedidoLogistica.findMany({
      where: { empresaId, ...(estado ? { estado } : {}) },
      include: PEDIDO_INCLUDE,
      orderBy: { creadoEn: 'desc' },
      take: limit + 1,
    });
    const has_more = rows.length > limit;
    return {
      object: 'list',
      data: rows.slice(0, limit).map((p) => this.toOrder(p)),
      has_more,
    };
  }

  private async resolveOrThrow(empresaId: number, id: string) {
    const pedido = await this.prisma.pedidoLogistica.findFirst({
      where: this.whereByPublicId(empresaId, id),
      include: PEDIDO_INCLUDE,
    });
    if (!pedido) throw new NotFoundException('Orden no encontrada.');
    return pedido;
  }

  async getOrderStatus(empresaId: number, id: string) {
    return this.toOrder(await this.resolveOrThrow(empresaId, id));
  }

  async cancelOrder(empresaId: number, id: string) {
    const pedido = await this.resolveOrThrow(empresaId, id);
    const noCancelables: EstadoPedidoLogistica[] = [
      'ENTREGADO',
      'CANCELADO',
      'DEVUELTO',
    ];
    if (noCancelables.includes(pedido.estado)) {
      throw new BadRequestException(
        `No se puede cancelar una orden en estado ${ESTADO_A_STATUS[pedido.estado]}.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.pedidoLogistica.update({
        where: { id: pedido.id },
        data: { estado: EstadoPedidoLogistica.CANCELADO },
      });
      await tx.historialEstadoPedidoLogistica.create({
        data: {
          pedidoId: pedido.id,
          estadoAnterior: pedido.estado,
          estadoNuevo: EstadoPedidoLogistica.CANCELADO,
          motivo: 'Cancelada vía API',
        },
      });
    });
    return this.toOrder(await this.resolveOrThrow(empresaId, id));
  }

  // ── Tracking ───────────────────────────────────────────────────────────────
  async getTracking(empresaId: number, id: string) {
    const pedido = await this.prisma.pedidoLogistica.findFirst({
      where: this.whereByPublicId(empresaId, id),
      include: { historialEstados: { orderBy: { creadoEn: 'asc' } } },
    });
    if (!pedido) throw new NotFoundException('Orden no encontrada.');
    return {
      status: ESTADO_A_STATUS[pedido.estado] ?? 'pending',
      courier: 'Falconext Logística',
      timeline: pedido.historialEstados.map((h) => ({
        status: ESTADO_A_STATUS[h.estadoNuevo] ?? 'pending',
        occurred_at: h.creadoEn.toISOString(),
        lat: num(h.lat),
        lng: num(h.lng),
      })),
    };
  }

  // ── Prueba de entrega (ya existía; ahora scopeada por empresa) ──────────────
  async getProof(empresaId: number, id: string) {
    const pedido = await this.prisma.pedidoLogistica.findFirst({
      where: this.whereByPublicId(empresaId, id),
      include: { pruebasEntrega: { orderBy: { creadoEn: 'desc' }, take: 1 } },
    });
    if (!pedido) throw new NotFoundException('Orden no encontrada.');
    const prueba = pedido.pruebasEntrega[0];
    if (!prueba) {
      throw new NotFoundException(
        'La orden aún no tiene una prueba de entrega registrada.',
      );
    }
    return {
      receiver_name: prueba.nombreReceptor ?? undefined,
      receiver_document: prueba.dniReceptor ?? undefined,
      relationship: prueba.parentesco ?? undefined,
      signature_url: prueba.firmaUrl ?? undefined,
      photo_urls: prueba.fotosUrls ?? [],
      collected_amount: num(prueba.montoCobrado),
      payment_method: prueba.metodoPago ?? undefined,
      delivered_at: prueba.creadoEn?.toISOString(),
    };
  }
}
