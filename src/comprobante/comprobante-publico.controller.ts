import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ComprobanteService } from './comprobante.service';

/**
 * Endpoints públicos (sin JWT) para descargar PDFs de comprobantes informales.
 * El acceso se protege con un token HMAC-SHA256 firmado con JWT_SECRET.
 */
@Controller('comprobante')
export class ComprobantePublicoController {
  constructor(private readonly service: ComprobanteService) {}

  @Get(':id/pdf-publico')
  async descargarPdf(
    @Param('id', ParseIntPipe) id: number,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token || !this.service.validarTokenPdf(id, token)) {
      throw new UnauthorizedException('Enlace inválido o expirado');
    }

    const { buffer } = await this.service.generarBufferPdf(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="comprobante-${id}.pdf"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
