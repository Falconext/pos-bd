import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { IdempotenciaInterceptor } from '../idempotencia/idempotencia.interceptor';
import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard';
import { ApiProducto } from '../api-keys/producto-api';
import { ErpApiService } from './erp.service';
import { ErpVentasService } from './erp-ventas.service';
import { ErpDatosService } from './erp-datos.service';
import { ErpAvisosService } from './erp-avisos.service';
import { esPrueba } from './modo-prueba';

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
 * Con una clave `sk_test_` las escrituras validan todo y devuelven cómo
 * habría quedado (`livemode: false`) sin guardar nada: ver `modo-prueba.ts`.
 *
 * `@ApiProducto('erp')`: una key de facturación (integradores) no lee
 * catálogos, y una de este producto no emite comprobantes.
 */
@ApiProducto('erp')
@UseGuards(ApiKeyAuthGuard)
@Controller('v1/erp')
export class ErpApiController {
  constructor(
    private readonly erp: ErpApiService,
    private readonly ventas: ErpVentasService,
    private readonly datos: ErpDatosService,
    private readonly avisos: ErpAvisosService,
  ) {}

  /**
   * Una venta de la web: boleta, factura o nota de venta, por el mismo camino
   * del POS. `Idempotency-Key` obligatoria: un reintento de la web no puede
   * emitir dos boletas. `external_id` (el número de pedido de la web) además
   * no se repite nunca, aunque cambie la key.
   */
  @Post('sales')
  @HttpCode(201)
  @UseInterceptors(IdempotenciaInterceptor)
  crearVenta(@Body() body: unknown, @Request() req: any) {
    return this.ventas.crear(req.apiEmpresaId, body, esPrueba(req));
  }

  @Get('sales')
  listarVentas(@Query() query: any, @Request() req: any) {
    return this.ventas.listar(req.apiEmpresaId, query ?? {});
  }

  /** Anula la venta: nota de venta directo; boleta o factura aceptada, con nota de crédito. */
  @Post('sales/:id/void')
  @HttpCode(200)
  @UseInterceptors(IdempotenciaInterceptor)
  anularVenta(@Param('id') id: string, @Body() body: unknown, @Request() req: any) {
    return this.ventas.anular(req.apiEmpresaId, id, body, esPrueba(req));
  }

  /** El PDF de la venta (a4 por defecto, ticket o a5): devuelve su URL. */
  @Get('sales/:id/pdf')
  pdfVenta(@Param('id') id: string, @Query('format') formato: string, @Request() req: any) {
    return this.ventas.pdf(req.apiEmpresaId, id, formato);
  }

  @Get('sales/:id')
  obtenerVenta(@Param('id') id: string, @Request() req: any) {
    return this.ventas.obtener(req.apiEmpresaId, id);
  }

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
    return this.erp.crearProducto(req.apiEmpresaId, body, urlBaseDe(req), esPrueba(req));
  }

  @Patch('products/:id')
  actualizar(@Param('id') id: string, @Body() body: unknown, @Request() req: any) {
    return this.erp.actualizarProducto(req.apiEmpresaId, id, body, urlBaseDe(req), esPrueba(req));
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
    return this.erp.ajustarStock(req.apiEmpresaId, id, body, esPrueba(req));
  }

  @Get('locations')
  sedes(@Request() req: any) {
    return this.erp.listarSedes(req.apiEmpresaId);
  }

  /** Crear categorías y marcas: para tener su id antes de crear productos. */
  @Post('categories')
  @HttpCode(201)
  @UseInterceptors(IdempotenciaInterceptor)
  crearCategoria(@Body() body: unknown, @Request() req: any) {
    return this.datos.crearCategoria(req.apiEmpresaId, body, esPrueba(req));
  }

  @Post('brands')
  @HttpCode(201)
  @UseInterceptors(IdempotenciaInterceptor)
  crearMarca(@Body() body: unknown, @Request() req: any) {
    return this.datos.crearMarca(req.apiEmpresaId, body, esPrueba(req));
  }

  @Get('customers')
  listarClientes(@Query() query: any, @Request() req: any) {
    return this.datos.listarClientes(req.apiEmpresaId, query ?? {});
  }

  @Get('customers/:id')
  obtenerCliente(@Param('id') id: string, @Request() req: any) {
    return this.datos.obtenerCliente(req.apiEmpresaId, id);
  }

  @Post('customers')
  @HttpCode(201)
  @UseInterceptors(IdempotenciaInterceptor)
  crearCliente(@Body() body: unknown, @Request() req: any) {
    return this.datos.crearCliente(req.apiEmpresaId, body, esPrueba(req));
  }

  @Patch('customers/:id')
  actualizarCliente(@Param('id') id: string, @Body() body: unknown, @Request() req: any) {
    return this.datos.actualizarCliente(req.apiEmpresaId, id, body, esPrueba(req));
  }

  /**
   * Webhooks: la web recibe un aviso firmado cuando SUNAT acepta, observa o
   * rechaza una venta, o cuando se anula. Es configuración, no venta: se
   * administra igual con clave de prueba o real.
   */
  @Post('webhook_endpoints')
  @HttpCode(201)
  crearWebhook(@Body() body: unknown, @Request() req: any) {
    return this.avisos.crearEndpoint(req.apiEmpresaId, body);
  }

  @Get('webhook_endpoints')
  listarWebhooks(@Request() req: any) {
    return this.avisos.listarEndpoints(req.apiEmpresaId);
  }

  @Delete('webhook_endpoints/:id')
  borrarWebhook(@Param('id') id: string, @Request() req: any) {
    return this.avisos.borrarEndpoint(req.apiEmpresaId, id);
  }

  @Post('webhook_endpoints/:id/test')
  @HttpCode(200)
  probarWebhook(@Param('id') id: string, @Request() req: any) {
    return this.avisos.probarEndpoint(req.apiEmpresaId, id);
  }

  @Get('brands')
  marcas(@Request() req: any) {
    return this.erp.listarMarcas(req.apiEmpresaId);
  }

  @Get('units')
  unidades(@Request() req: any) {
    return this.erp.listarUnidades(req.apiEmpresaId);
  }

  @Get('categories')
  categorias(@Request() req: any) {
    return this.erp.listarCategorias(req.apiEmpresaId);
  }
}
