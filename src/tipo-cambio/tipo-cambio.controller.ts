import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TipoCambioService } from './tipo-cambio.service';

@UseGuards(JwtAuthGuard)
@Controller('tipo-cambio')
export class TipoCambioController {
  constructor(private readonly service: TipoCambioService) {}

  // GET /api/tipo-cambio            -> tipo de cambio de hoy
  // GET /api/tipo-cambio?fecha=...  -> tipo de cambio de una fecha (yyyy-mm-dd)
  @Get()
  async consultar(@Query('fecha') fecha?: string) {
    return this.service.consultar(fecha);
  }

  // GET /api/tipo-cambio/2025-10-03 -> tipo de cambio de una fecha específica
  @Get(':fecha')
  async consultarPorFecha(@Param('fecha') fecha: string) {
    return this.service.consultar(fecha);
  }
}
