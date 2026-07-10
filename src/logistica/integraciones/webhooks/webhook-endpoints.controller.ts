import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiExtraModels,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard';
import {
  WebhookEndpointCreate,
  WebhookEndpoint,
  ErrorResponse,
} from '../external-orders/dto/openapi-facade.dto';

// NOTA: las anotaciones @Api* son SOLO para documentación (OpenAPI). El `@Body()`
// sigue siendo `any`; la validación mínima vive en el servicio. La fachada
// inglesa vive en external-orders/dto/openapi-facade.dto.ts.
@ApiTags('Webhooks')
@ApiBearerAuth('bearerAuth')
@ApiExtraModels(WebhookEndpoint, ErrorResponse)
@UseGuards(ApiKeyAuthGuard)
@Controller('v1/logistics/webhook_endpoints')
export class WebhookEndpointsController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  @ApiOperation({
    operationId: 'createWebhookEndpoint',
    summary: 'Registrar un endpoint de webhook',
    description:
      'Registra una URL para recibir eventos order.* y devuelve el secreto de firma HMAC.',
  })
  @ApiBody({ type: WebhookEndpointCreate })
  @ApiResponse({
    status: 201,
    description: 'Endpoint registrado.',
    type: WebhookEndpoint,
  })
  @ApiResponse({
    status: 422,
    description: 'Parámetros inválidos.',
    type: ErrorResponse,
  })
  async createWebhookEndpoint(@Body() payload: any, @Request() req: any) {
    return this.webhooks.createEndpoint(req.logisticaEmpresaId, payload);
  }
}
