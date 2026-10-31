import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LibroReclamacionesService } from './libro-reclamaciones.service';
import { RegistrarReclamacionDto } from './dto/registrar-reclamacion.dto';

/**
 * Libro de Reclamaciones virtual de la tienda pública (sin sesión). El POST
 * está acotado por IP en `authRateLimit` (common/security/rate-limit.middleware).
 */
@Controller('public/store')
export class LibroReclamacionesPublicController {
  constructor(private readonly service: LibroReclamacionesService) {}

  @Get(':slug/libro-reclamaciones')
  proveedor(@Param('slug') slug: string) {
    return this.service.proveedorPublico(slug);
  }

  @Post(':slug/libro-reclamaciones')
  registrar(
    @Param('slug') slug: string,
    @Body() dto: RegistrarReclamacionDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.locals.message = 'Hoja de reclamación registrada';
    return this.service.registrar(slug, dto, {
      ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get(':slug/libro-reclamaciones/:codigo/constancia')
  async constancia(
    @Param('slug') slug: string,
    @Param('codigo') codigo: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const { codigo: c, pdf } = await this.service.constanciaPublica(
      slug,
      codigo,
      token,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="hoja-reclamacion-${c}.pdf"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end(pdf);
  }
}
