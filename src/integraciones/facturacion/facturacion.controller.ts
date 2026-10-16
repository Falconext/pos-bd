import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard';
import { ApiProducto } from '../api-keys/producto-api';
import { IdempotenciaInterceptor } from '../idempotencia/idempotencia.interceptor';
import { EmisoresService } from '../emisores/emisores.service';
import { WebhooksService } from '../../logistica/integraciones/webhooks/webhooks.service';
import { FacturacionApiService } from './facturacion.service';

/**
 * La API pública de facturación.
 *
 * Tres decisiones que se ven en las anotaciones y conviene no deshacer:
 *
 *  - `@ApiProducto('facturacion')`: una key de logística NO emite facturas.
 *    Sin esto, una key filtrada de un integrador de envíos alcanzaría para
 *    firmar comprobantes ante SUNAT a nombre de la empresa.
 *
 *  - `@UseInterceptors(IdempotenciaInterceptor)` en todo lo que escribe: la
 *    `Idempotency-Key` es obligatoria, no opcional. Es más áspero de integrar
 *    y evita el único error de esta API que no tiene arreglo barato —emitir
 *    dos veces la misma venta— cuando un timeout hace reintentar al cliente.
 *
 *  - `req.apiEmpresaId` es el **integrador**, no el emisor. Cada operación
 *    resuelve el emisor por su `issuer_id` comprobando que le pertenezca.
 */
@ApiProducto('facturacion')
@UseGuards(ApiKeyAuthGuard)
@Controller('v1/invoicing')
export class FacturacionApiController {
  constructor(
    private readonly facturacion: FacturacionApiService,
    private readonly emisores: EmisoresService,
    private readonly webhooks: WebhooksService,
  ) {}

  /**
   * Emite una factura o boleta.
   *
   * Responde 202 y no 201 a propósito: el comprobante existe y tiene
   * correlativo, pero SUNAT todavía no lo vio. Decir 201 "creado" invitaría a
   * tratarlo como aceptado y a entregarle el PDF al cliente antes de tiempo.
   */
  @Post('invoices')
  @HttpCode(202)
  @UseInterceptors(IdempotenciaInterceptor)
  async crear(@Body() cuerpo: any, @Request() req: any) {
    return this.facturacion.emitir(req.apiEmpresaId, cuerpo);
  }

  @Get('invoices')
  async listar(@Query() query: any, @Request() req: any) {
    return this.facturacion.listar(req.apiEmpresaId, {
      issuerId: query?.issuer_id,
      limite: query?.limit,
      cursor: query?.cursor,
    });
  }

  @Get('invoices/:id')
  async obtener(@Param('id') id: string, @Request() req: any) {
    return this.facturacion.obtener(req.apiEmpresaId, id);
  }

  /** Los emisores (RUCs) por los que este integrador puede emitir. */
  @Get('issuers')
  async listarEmisores(@Request() req: any) {
    return { object: 'list', data: await this.emisores.listar(req.apiEmpresaId) };
  }

  @Get('issuers/:id')
  async obtenerEmisor(@Param('id') id: string, @Request() req: any) {
    const e = await this.emisores.resolverParaIntegrador(req.apiEmpresaId, id);
    return this.emisores.vistaPublica(e);
  }

  /**
   * Registra una URL para recibir los eventos.
   *
   * El `secret` se devuelve UNA sola vez, acá. No se puede volver a leer:
   * si el listado lo mostrara, cualquier lectura serviría para robar la firma
   * y falsificar eventos.
   */
  @Post('webhook_endpoints')
  @UseInterceptors(IdempotenciaInterceptor)
  async crearWebhook(@Body() cuerpo: any, @Request() req: any) {
    return this.webhooks.createEndpoint(req.apiEmpresaId, cuerpo, 'facturacion');
  }

  @Get('webhook_endpoints')
  async listarWebhooks(@Request() req: any) {
    return {
      object: 'list',
      data: await this.webhooks.listEndpoints(req.apiEmpresaId, 'facturacion'),
    };
  }
}
