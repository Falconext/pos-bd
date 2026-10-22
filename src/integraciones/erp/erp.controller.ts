import { Controller, Get, Param, Query, Request, Res, UseGuards } from '@nestjs/common';
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
 * mostrarlos en su web. Solo lectura por ahora.
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

  @Get('locations')
  sedes(@Request() req: any) {
    return this.erp.listarSedes(req.apiEmpresaId);
  }

  @Get('categories')
  categorias(@Request() req: any) {
    return this.erp.listarCategorias(req.apiEmpresaId);
  }
}

/**
 * Las fotos de producto con dirección fija (ver imagen-publica.ts). Sin API
 * key: un `<img>` no manda cabeceras. Lo que protege es la firma del token.
 */
@Controller('v1/erp/images')
export class ErpImagenesController {
  constructor(private readonly erp: ErpApiService) {}

  @Get(':token')
  async imagen(@Param('token') token: string, @Res() res: any) {
    const url = await this.erp.urlFirmadaDeImagen(token);
    // Menos que lo que dura el enlace firmado (1 h): el navegador no debe
    // guardar la redirección más allá de que el enlace venza.
    res.set('Cache-Control', 'public, max-age=1800');
    res.redirect(302, url);
  }
}
