import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { S3Service } from '../s3/s3.service';
import { clavePublicable } from './seo-texto';

/** Anchos permitidos: uno por uso, para que la caché no se llene de variantes. */
const ANCHOS = new Set([200, 400, 800, 1200]);
const MAX_BYTES_CACHE = 64 * 1024 * 1024;

/**
 * Imágenes de catálogo en una URL que no caduca.
 *
 * El bucket es privado y la tienda firma cada foto por 10 minutos: sirve para
 * mostrarla en el navegador, pero Google, WhatsApp y Facebook guardan la URL y
 * la vuelven a pedir horas o días después. Esta ruta lee el objeto de S3 y lo
 * devuelve con caché pública larga (las claves llevan timestamp: si la foto
 * cambia, cambia la clave). Solo responde por las carpetas de catálogo
 * (`clavePublicable`).
 *
 * `?w=1200&f=jpg` es la imagen para compartir: JPEG porque WhatsApp no
 * siempre muestra WebP en la vista previa.
 */
@Controller('public/img')
export class ImagenPublicaController {
  private readonly logger = new Logger(ImagenPublicaController.name);
  private readonly cache = new Map<string, { buffer: Buffer; tipo: string }>();
  private bytesEnCache = 0;

  constructor(private readonly s3: S3Service) {}

  @Get('*clave')
  async servir(
    @Req() req: Request,
    @Res() res: Response,
    @Query('w') w?: string,
    @Query('f') f?: string,
  ) {
    const clave = decodeURIComponent(req.path.replace(/^.*?\/public\/img\//, ''));
    if (!clavePublicable(clave)) return res.status(404).send('No encontrada');

    const ancho = Number(w);
    const formato = f === 'jpg' ? 'jpg' : f === 'webp' ? 'webp' : null;
    const variante = `${clave}|${ANCHOS.has(ancho) ? ancho : 0}|${formato ?? ''}`;

    let img = this.cache.get(variante);
    if (!img) {
      const original = await this.s3.obtenerObjeto(clave).catch((e) => {
        this.logger.warn(`Imagen ${clave}: ${e?.message}`);
        return null;
      });
      if (!original || !String(original.contentType || 'image/').startsWith('image/')) {
        return res.status(404).send('No encontrada');
      }
      img = await this.transformar(original.buffer, original.contentType || 'image/webp', ANCHOS.has(ancho) ? ancho : null, formato);
      this.guardar(variante, img);
    }

    res.setHeader('Content-Type', img.tipo);
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(img.buffer);
  }

  private async transformar(buffer: Buffer, tipo: string, ancho: number | null, formato: 'jpg' | 'webp' | null) {
    if (!ancho && !formato) return { buffer, tipo };
    try {
      // @ts-ignore — misma carga dinámica que S3Service.uploadImage
      const sharp = (await import('sharp')).default as any;
      let p = sharp(buffer).rotate();
      if (ancho) p = p.resize({ width: ancho, withoutEnlargement: true });
      // JPEG sin transparencia: fondo blanco (un PNG de logo quedaría negro).
      if (formato === 'jpg') return { buffer: await p.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(), tipo: 'image/jpeg' };
      return { buffer: await p.webp({ quality: 80 }).toBuffer(), tipo: 'image/webp' };
    } catch (e: any) {
      this.logger.warn(`No se pudo transformar la imagen: ${e?.message}`);
      return { buffer, tipo };
    }
  }

  private guardar(clave: string, img: { buffer: Buffer; tipo: string }) {
    if (img.buffer.length > 4 * 1024 * 1024) return;
    while (this.bytesEnCache + img.buffer.length > MAX_BYTES_CACHE && this.cache.size) {
      const primera = this.cache.keys().next().value as string;
      this.bytesEnCache -= this.cache.get(primera)!.buffer.length;
      this.cache.delete(primera);
    }
    this.cache.set(clave, img);
    this.bytesEnCache += img.buffer.length;
  }
}
