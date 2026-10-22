import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { IdempotenciaInterceptor } from '../idempotencia/idempotencia.interceptor';
import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard';
import { ApiProducto } from '../api-keys/producto-api';
import { ErpApiService } from './erp.service';

/**
 * De dónde armar las URLs de las fotos: el mismo host por el que entró la
 * petición. Detrás del proxy de Railway llega como http, así que fuera de
 * localhost se fuerza https.
 */
export function urlBaseDe(req: any): string {
  const host = String(req?.headers?.['x-forwarded-host'] ?? req?.headers?.host ?? 'localhost:4001');
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
}

/**
 * La API de Krezka para el propio negocio: su catálogo y su stock, para
 * mostrarlos en su web y cargarlos desde ella.
 *
 * Lo que crea o suma lleva `Idempotency-Key` obligatoria (como Facturación):
 * si la web reintenta por un timeout, no se crea el producto dos veces ni se
 * suma el stock dos veces. El PATCH no la necesita: aplicar dos veces el
 * mismo cambio deja el mismo resultado.
 *
 * `@ApiProducto('erp')`: una key de facturación (integradores) no lee
 * catálogos, y una de este producto no emite comprobantes.
 */
@ApiProducto('erp')
@UseGuards(ApiKeyAuthGuard)
@Controller('v1/erp')
export class ErpApiController {
  constructor(private readonly erp: ErpApiService) {}

  @Get('products')
  listar(@Query() query: any, @Request() req: any) {
    return this.erp.listarProductos(req.apiEmpresaId, query ?? {}, urlBaseDe(req));
  }

  @Get('products/:id')
  obtener(@Param('id') id: string, @Query('location_id') locationId: string, @Request() req: any) {
    return this.erp.obtenerProducto(req.apiEmpresaId, id, locationId, urlBaseDe(req));
  }

  @Post('products')
  @HttpCode(201)
  @UseInterceptors(IdempotenciaInterceptor)
  crear(@Body() body: unknown, @Request() req: any) {
    return this.erp.crearProducto(req.apiEmpresaId, body, urlBaseDe(req));
  }

  @Patch('products/:id')
  actualizar(@Param('id') id: string, @Body() body: unknown, @Request() req: any) {
    return this.erp.actualizarProducto(req.apiEmpresaId, id, body, urlBaseDe(req));
  }

  /**
   * Cambia el stock de una sede, con su movimiento en el kardex. No va en el
   * PATCH del producto a propósito: un stock que cambia sin motivo ni
   * movimiento es un descuadre que nadie puede explicar después.
   */
  @Post('products/:id/stock_adjustments')
  @HttpCode(201)
  @UseInterceptors(IdempotenciaInterceptor)
  ajustarStock(@Param('id') id: string, @Body() body: unknown, @Request() req: any) {
    return this.erp.ajustarStock(req.apiEmpresaId, id, body);
  }

  @Get('locations')
  sedes(@Request() req: any) {
    return this.erp.listarSedes(req.apiEmpresaId);
  }

  @Get('categories')
  categorias(@Request() req: any) {
    return this.erp.listarCategorias(req.apiEmpresaId);
  }
}
