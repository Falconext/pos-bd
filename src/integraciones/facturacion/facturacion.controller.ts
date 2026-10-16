import {
  Body,
  Controller,
  Get,
  Header,
  Res,
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
import { MedidorApiService } from './medidor.service';

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
    private readonly medidor: MedidorApiService,
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

  /**
   * El consumo del mes, con el detalle por emisor.
   *
   * Existe para que el integrador no se entere de lo que debe el día que le
   * llega la factura. Mientras el período está abierto el número se calcula
   * en vivo contra los comprobantes; una vez cerrado devuelve lo congelado,
   * que es exactamente lo que dice la factura.
   */
  @Get('usage')
  async consumo(@Query('period') periodo: string, @Request() req: any) {
    return this.medidor.consumo(req.apiEmpresaId, periodo || undefined);
  }

  /** Los emisores (RUCs) por los que este integrador puede emitir. */
  /**
   * Las descargas.
   *
   * Van como archivo y no como base64 en un JSON: un XML de 40 líneas pesa
   * poco, pero un PDF de varias páginas en base64 infla la respuesta un 33% y
   * obliga al integrador a decodificar antes de poder guardarlo.
   */
  @Get('invoices/:id/xml')
  async descargarXml(@Param('id') id: string, @Request() req: any, @Res() res: any) {
    return this.enviarArchivo(res, await this.facturacion.xml(req.apiEmpresaId, id));
  }

  @Get('invoices/:id/cdr')
  async descargarCdr(@Param('id') id: string, @Request() req: any, @Res() res: any) {
    return this.enviarArchivo(res, await this.facturacion.cdr(req.apiEmpresaId, id));
  }

  @Get('invoices/:id/pdf')
  async descargarPdf(
    @Param('id') id: string,
    @Query('format') formato: string,
    @Request() req: any,
    @Res() res: any,
  ) {
    const f = ['a4', 'a5', 'ticket'].includes(formato) ? (formato as any) : 'a4';
    return this.enviarArchivo(res, await this.facturacion.pdf(req.apiEmpresaId, id, f));
  }

  /**
   * La comunicación de baja.
   *
   * Lleva `Idempotency-Key` como la emisión: un reintento tras un timeout no
   * puede terminar en dos comunicaciones de baja por el mismo comprobante.
   */
  @Post('invoices/:id/void')
  @HttpCode(202)
  @UseInterceptors(IdempotenciaInterceptor)
  async anular(@Param('id') id: string, @Body() cuerpo: any, @Request() req: any) {
    return this.facturacion.anular(req.apiEmpresaId, id, cuerpo?.reason);
  }

  @Post('credit_notes')
  @HttpCode(202)
  @UseInterceptors(IdempotenciaInterceptor)
  async crearNotaCredito(@Body() cuerpo: any, @Request() req: any) {
    return this.facturacion.crearNotaCredito(req.apiEmpresaId, cuerpo);
  }

  @Get('credit_notes/:id')
  async obtenerNotaCredito(@Param('id') id: string, @Request() req: any) {
    return this.facturacion.obtenerNotaCredito(req.apiEmpresaId, id);
  }

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

  /**
   * Manda el archivo tal cual, sin pasar por el interceptor que envuelve todo
   * en `{ code, message, data }`. Un XML envuelto en JSON no lo puede abrir
   * ningún lector de comprobantes.
   */
  private enviarArchivo(
    res: any,
    archivo: { buffer: Buffer; filename: string; contentType: string },
  ) {
    res.set({
      'Content-Type': archivo.contentType,
      'Content-Disposition': `attachment; filename="${archivo.filename}"`,
      'Content-Length': String(archivo.buffer.length),
    });
    return res.send(archivo.buffer);
  }
}
