import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SeoService } from './seo.service';

/**
 * Metadatos y sitemaps de las tiendas públicas. Sin guardias: los consume el
 * middleware de Vercel (pos-web/middleware.ts) en cada visita a una tienda.
 */
@Controller('public/seo')
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  /** `?path=/tienda/flores/producto/12&category=Ramos` → título, descripción, canónico, JSON-LD. */
  @Get()
  async pagina(
    @Query('path') path: string,
    @Query('category') categoria: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
    return this.seo.pagina(path || '/', categoria);
  }

  @Get('sitemap.xml')
  async indice(@Query('host') host: string | undefined, @Res() res: Response) {
    return this.xml(res, await this.seo.sitemapIndice(host));
  }

  @Get('sitemap/:archivo')
  async sitemapTienda(@Param('archivo') archivo: string, @Res() res: Response) {
    const slug = archivo.replace(/\.xml$/i, '');
    try {
      return this.xml(res, await this.seo.sitemapTienda(slug));
    } catch (e) {
      if (e instanceof NotFoundException) return res.status(404).type('text/plain').send('Sin sitemap');
      throw e;
    }
  }

  private xml(res: Response, cuerpo: string) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600');
    return res.send(cuerpo);
  }
}
