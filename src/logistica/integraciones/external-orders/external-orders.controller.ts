import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiParam,
  ApiExtraModels,
} from '@nestjs/swagger';
import { ExternalOrdersService } from './external-orders.service';
import { SandboxService } from '../sandbox/sandbox.service';
import { RateLimitsService } from '../rate-limits/rate-limits.service';
import {
  OrderCreate,
  Order,
  OrderList,
  Tracking,
  ErrorResponse,
} from './dto/openapi-facade.dto';
// import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard'; // Assume this will exist

// NOTA: las anotaciones @Api* son SOLO para documentación (OpenAPI). Las firmas
// runtime siguen recibiendo `any` — no se agrega validación nueva para no alterar
// el comportamiento de integraciones existentes. La fachada inglesa vive en
// dto/openapi-facade.dto.ts.
@ApiTags('Pedidos')
@ApiExtraModels(Order, OrderList, Tracking, ErrorResponse)
@Controller('v1/logistics/orders')
// @UseGuards(ApiKeyAuthGuard) // Protect all endpoints in this controller
export class ExternalOrdersController {
  constructor(
    private readonly ordersService: ExternalOrdersService,
    private readonly sandboxService: SandboxService,
    private readonly rateLimitsService: RateLimitsService,
  ) {}

  @Post()
  @ApiOperation({
    operationId: 'createOrder',
    summary: 'Crear una orden',
    description: 'Registra una orden de entrega para un cliente final.',
  })
  @ApiBody({ type: OrderCreate })
  @ApiResponse({ status: 201, description: 'Orden creada.', type: Order })
  @ApiResponse({
    status: 400,
    description: 'Solicitud inválida.',
    type: ErrorResponse,
  })
  async createOrder(@Body() payload: any) {
    return this.ordersService.createOrder(payload);
  }

  @Post('bulk')
  @ApiOperation({
    operationId: 'createBulkOrders',
    summary: 'Crear órdenes en lote',
    description: 'Crea múltiples órdenes en una sola llamada.',
  })
  @ApiBody({ type: [OrderCreate] })
  @ApiResponse({ status: 201, description: 'Órdenes creadas.', type: [Order] })
  async createBulkOrders(@Body() payload: any[]) {
    return this.ordersService.createBulkOrders(payload);
  }

  @Get()
  @ApiOperation({
    operationId: 'listOrders',
    summary: 'Listar órdenes',
    description: 'Devuelve las órdenes de tu cuenta con paginación.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de órdenes.',
    type: OrderList,
  })
  async getOrders(@Query() query: any) {
    return this.ordersService.getOrders(query);
  }

  @Get(':id/status')
  @ApiOperation({
    operationId: 'getOrder',
    summary: 'Obtener una orden',
    description:
      'Devuelve el detalle y estado actual de una orden por su id o tracking_code.',
  })
  @ApiParam({ name: 'id', description: 'id de Falconext o tracking_code.' })
  @ApiResponse({ status: 200, description: 'Detalle de la orden.', type: Order })
  @ApiResponse({
    status: 404,
    description: 'No encontrada.',
    type: ErrorResponse,
  })
  async getOrderStatus(@Param('id') id: string) {
    return this.ordersService.getOrderStatus(id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    operationId: 'cancelOrder',
    summary: 'Cancelar una orden',
    description: 'Cancela una orden que aún no ha sido entregada.',
  })
  @ApiParam({ name: 'id', description: 'id de Falconext o tracking_code.' })
  @ApiResponse({ status: 200, description: 'Orden cancelada.', type: Order })
  @ApiResponse({
    status: 400,
    description: 'No se puede cancelar en este estado.',
    type: ErrorResponse,
  })
  async cancelOrder(@Param('id') id: string) {
    return this.ordersService.cancelOrder(id);
  }
}

@ApiTags('Rastreo')
@Controller('v1/logistics/tracking')
export class TrackingController {
  constructor(private readonly ordersService: ExternalOrdersService) {}

  @Get(':id')
  @ApiOperation({
    operationId: 'trackOrder',
    summary: 'Rastrear una orden',
    description:
      'Devuelve el estado y la línea de tiempo de eventos de una orden.',
  })
  @ApiParam({ name: 'id', description: 'id de Falconext o tracking_code.' })
  @ApiResponse({
    status: 200,
    description: 'Rastreo de la orden.',
    type: Tracking,
  })
  @ApiResponse({
    status: 404,
    description: 'No encontrada.',
    type: ErrorResponse,
  })
  async getTracking(@Param('id') id: string) {
    return this.ordersService.getTracking(id);
  }
}
