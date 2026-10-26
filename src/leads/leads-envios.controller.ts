import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { User } from '../common/decorators/user.decorator';
import { LeadsSegmentosService } from './leads-segmentos.service';
import { FiltrosDto, GuardarSegmentoDto } from './dto/envios.dto';

/**
 * Envíos masivos de la IA de Ventas: segmentos, plantillas y envíos.
 * Mismo gate que el resto del módulo (plan con `leads`).
 */
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('leads')
@Controller('leads')
export class LeadsEnviosController {
  constructor(private readonly segmentos: LeadsSegmentosService) {}

  // ─── Segmentos ─────────────────────────────────────────────────────────

  @Get('segmentos')
  listarSegmentos(@User() user: any) {
    return this.segmentos.listar(user.empresaId);
  }

  @Get('segmentos/opciones')
  opcionesSegmento(@User() user: any) {
    return this.segmentos.opciones(user.empresaId);
  }

  @Get('segmentos/productos')
  buscarProductos(
    @User() user: any,
    @Query('q') q: string,
    @Query('ids') ids?: string,
  ) {
    const lista = (ids ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    return this.segmentos.buscarProductos(user.empresaId, q, lista);
  }

  /** Cuántos cumplen el filtro y cuántos recibirían, con una muestra. */
  @Post('segmentos/previsualizar')
  previsualizar(@User() user: any, @Body() dto: FiltrosDto) {
    return this.segmentos.previsualizar(user.empresaId, dto.filtros ?? {});
  }

  @Post('segmentos')
  guardarSegmento(@User() user: any, @Body() dto: GuardarSegmentoDto) {
    return this.segmentos.guardar(user.empresaId, dto);
  }

  @Delete('segmentos/:id')
  eliminarSegmento(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.segmentos.eliminar(user.empresaId, id);
  }
}
