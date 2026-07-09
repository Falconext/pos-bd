/**
 * Fachada pública (inglés) de la API de Logística para documentación OpenAPI.
 *
 * Estas clases NO se usan para binding/validación en runtime (los controllers
 * públicos siguen recibiendo `any`): existen SOLO para que `@nestjs/swagger`
 * genere un contrato que COINCIDA con el del portal de desarrolladores
 * (`public/openapi/logistica/2025-07-01.json`). Por eso:
 *  - los nombres de campo son snake_case en inglés (`tracking_code`,
 *    `external_order_id`), no los internos en español (`codigoTracking`…);
 *  - los estados son el enum snake_case inglés (pending, assigned, …).
 *
 * Mapeo interno→fachada: ver HANDOFF §5 (PedidoLogistica → Order, etc.).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Enums ───────────────────────────────────────────────────────────────────
export enum OrderStatus {
  pending = 'pending',
  validated = 'validated',
  assigned = 'assigned',
  ready_for_pickup = 'ready_for_pickup',
  picked_up = 'picked_up',
  in_transit = 'in_transit',
  arriving = 'arriving',
  at_location = 'at_location',
  delivered = 'delivered',
  partially_delivered = 'partially_delivered',
  failed = 'failed',
  returned = 'returned',
  rescheduled = 'rescheduled',
  cancelled = 'cancelled',
}

export enum OrderSource {
  manual = 'manual',
  excel = 'excel',
  api = 'api',
  webhook = 'webhook',
  ecommerce = 'ecommerce',
  falconext_erp = 'falconext_erp',
  falconext = 'falconext',
}

// ─── Objetos anidados ──────────────────────────────────────────────────────────
export class Customer {
  @ApiProperty({ example: 'Juan Pérez' })
  name: string;

  @ApiPropertyOptional({ example: 'DNI', description: 'DNI, RUC, CE, PASSPORT' })
  document_type?: string;

  @ApiPropertyOptional({ example: '12345678' })
  document_number?: string;

  @ApiPropertyOptional({ format: 'email', example: 'juan@ejemplo.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+51999888777' })
  phone?: string;

  @ApiPropertyOptional({ example: '+51999888777' })
  whatsapp?: string;
}

export class Address {
  @ApiPropertyOptional({ example: 'Casa' })
  label?: string;

  @ApiProperty({ example: 'Av. Javier Prado 123' })
  address: string;

  @ApiPropertyOptional({ example: 'San Isidro' })
  district?: string;

  @ApiPropertyOptional({ example: 'Lima' })
  city?: string;

  @ApiPropertyOptional({ example: 'Lima' })
  department?: string;

  @ApiPropertyOptional({ example: -12.0931 })
  lat?: number;

  @ApiPropertyOptional({ example: -77.0465 })
  lng?: number;

  @ApiPropertyOptional({ example: 'Frente al parque' })
  reference?: string;

  @ApiPropertyOptional({ example: 'Tocar timbre 2' })
  access_notes?: string;
}

export class OrderItem {
  @ApiPropertyOptional({ example: 'SKU-001' })
  sku?: string;

  @ApiProperty({ example: 'Caja de zapatos talla 42' })
  description: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  quantity?: number;

  @ApiPropertyOptional({ example: 0.8 })
  weight_kg?: number;

  @ApiPropertyOptional({ example: 120.5 })
  declared_value?: number;
}

export class TimeWindow {
  @ApiPropertyOptional({ example: '09:00', description: 'Hora inicio HH:mm' })
  start?: string;

  @ApiPropertyOptional({ example: '13:00', description: 'Hora fin HH:mm' })
  end?: string;
}

// ─── Order (request/response) ───────────────────────────────────────────────────
export class OrderCreate {
  @ApiPropertyOptional({
    description: 'Tu identificador de la orden en tu propio sistema (idempotencia).',
    example: 'ORD-2025-0001',
  })
  external_order_id?: string;

  @ApiPropertyOptional({ enum: OrderSource, enumName: 'OrderSource', example: OrderSource.api })
  source?: OrderSource;

  @ApiProperty({ type: Customer })
  customer: Customer;

  @ApiProperty({ type: Address })
  delivery_address: Address;

  @ApiPropertyOptional({ type: [OrderItem] })
  items?: OrderItem[];

  @ApiPropertyOptional({ format: 'date', example: '2025-07-15' })
  requested_date?: string;

  @ApiPropertyOptional({ type: TimeWindow })
  time_window?: TimeWindow;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, example: 5 })
  priority?: number;

  @ApiPropertyOptional({ default: false })
  is_urgent?: boolean;

  @ApiPropertyOptional({ default: false })
  requires_signature?: boolean;

  @ApiPropertyOptional({ default: false })
  requires_photo?: boolean;

  @ApiPropertyOptional({
    description: 'Monto a cobrar contra entrega (COD), en soles.',
    example: 150.0,
  })
  cash_on_delivery?: number;

  @ApiPropertyOptional({ example: 'Llamar antes de llegar' })
  customer_notes?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Datos libres que se devuelven tal cual.',
  })
  metadata?: Record<string, any>;
}

export class Order {
  @ApiProperty({ example: 'ord_9f8c1a2b', description: 'ID único de Falconext.' })
  id: string;

  @ApiProperty({ example: 'order', default: 'order' })
  object: string;

  @ApiProperty({ example: 'FLX-7GK2P9', description: 'Código público de rastreo.' })
  tracking_code: string;

  @ApiPropertyOptional({ example: 'ORD-2025-0001' })
  external_order_id?: string;

  @ApiProperty({ enum: OrderSource, enumName: 'OrderSource' })
  source: OrderSource;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;

  @ApiProperty({ type: Customer })
  customer: Customer;

  @ApiProperty({ type: Address })
  delivery_address: Address;

  @ApiPropertyOptional({ type: [OrderItem] })
  items?: OrderItem[];

  @ApiPropertyOptional({ example: 2.4 })
  weight_kg?: number;

  @ApiPropertyOptional({ example: 1 })
  packages?: number;

  @ApiPropertyOptional({ example: 150.0 })
  cash_on_delivery?: number;

  @ApiPropertyOptional({ example: 12.0 })
  shipping_cost?: number;

  @ApiProperty({ format: 'date-time', example: '2025-07-14T18:30:00Z' })
  created_at: string;

  @ApiProperty({ format: 'date-time', example: '2025-07-14T18:30:00Z' })
  updated_at: string;
}

export class OrderList {
  @ApiProperty({ example: 'list', default: 'list' })
  object: string;

  @ApiProperty({ type: [Order] })
  data: Order[];

  @ApiProperty({ example: false, description: 'Hay más resultados en la siguiente página.' })
  has_more: boolean;
}

// ─── Tracking ───────────────────────────────────────────────────────────────────
export class TrackingEvent {
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;

  @ApiProperty({ format: 'date-time', example: '2025-07-14T19:05:00Z' })
  occurred_at: string;

  @ApiPropertyOptional({ example: -12.0931 })
  lat?: number;

  @ApiPropertyOptional({ example: -77.0465 })
  lng?: number;
}

export class Tracking {
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;

  @ApiPropertyOptional({ example: 'Falconext Logística' })
  courier?: string;

  @ApiPropertyOptional({ example: 25, description: 'Minutos estimados para la entrega.' })
  eta_minutes?: number;

  @ApiProperty({ type: [TrackingEvent] })
  timeline: TrackingEvent[];
}

// ─── Proof of delivery ──────────────────────────────────────────────────────────
export class ProofOfDelivery {
  @ApiPropertyOptional({ example: 'María Pérez' })
  receiver_name?: string;

  @ApiPropertyOptional({ example: '87654321' })
  receiver_document?: string;

  @ApiPropertyOptional({ example: 'Familiar', description: 'Relación del receptor con el cliente.' })
  relationship?: string;

  @ApiPropertyOptional({ format: 'uri' })
  signature_url?: string;

  @ApiPropertyOptional({ type: [String], format: 'uri' })
  photo_urls?: string[];

  @ApiPropertyOptional({ example: 150.0, description: 'Monto COD efectivamente cobrado.' })
  collected_amount?: number;

  @ApiPropertyOptional({ example: 'cash' })
  payment_method?: string;

  @ApiProperty({ format: 'date-time', example: '2025-07-14T20:10:00Z' })
  delivered_at: string;
}

// ─── Webhooks ───────────────────────────────────────────────────────────────────
export class WebhookEndpointCreate {
  @ApiProperty({ format: 'uri', example: 'https://miapp.com/webhooks/falconext' })
  url: string;

  @ApiProperty({
    type: [String],
    example: ['order.delivered', 'order.failed'],
    description: 'Eventos suscritos (order.*).',
  })
  events: string[];
}

export class WebhookEndpoint {
  @ApiProperty({ example: 'we_1a2b3c' })
  id: string;

  @ApiProperty({ format: 'uri' })
  url: string;

  @ApiProperty({ example: 'whsec_...', description: 'Secreto para verificar la firma HMAC.' })
  secret: string;

  @ApiProperty({ type: [String] })
  events: string[];
}

// ─── Error ──────────────────────────────────────────────────────────────────────
export class ErrorResponse {
  @ApiProperty({
    type: 'object',
    example: { code: 'invalid_request', message: 'delivery_address es requerido' },
    additionalProperties: true,
  })
  error: Record<string, any>;
}
