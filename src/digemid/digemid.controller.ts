import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { DigemidService } from './digemid.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('digemid')
export class DigemidController {
  constructor(private readonly service: DigemidService) {}

  @Get('buscar')
  async buscar(
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    const results = await this.service.buscar(q, limit ? Number(limit) : 20);
    return results;
  }

  @Get('barcode/:codigo')
  async buscarPorBarcode(@Param('codigo') codigo: string) {
    return this.service.buscarPorBarcode(codigo);
  }

  @Get('estado')
  async estado() {
    const total = await this.service.totalRegistros();
    return { total, cargado: total > 0 };
  }
}
