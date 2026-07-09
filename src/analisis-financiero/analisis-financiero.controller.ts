import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';
import { AnalisisFinancieroService } from './analisis-financiero.service';
import { QueryPeriodoDto } from './dto/query-periodo.dto';
import { CrearGastoDto } from './dto/crear-gasto.dto';
import { ActualizarGastoDto } from './dto/actualizar-gasto.dto';

@Controller('analisis-financiero')
@UseGuards(JwtAuthGuard)
export class AnalisisFinancieroController {
  constructor(private readonly service: AnalisisFinancieroService) {}

  /** GET /analisis-financiero/pnl?mes=&anio= */
  @Get('pnl')
  getPnl(@User() user: any, @Query() query: QueryPeriodoDto) {
    return this.service.getPnl(user.empresaId, query.mes, query.anio);
  }

  /**
   * GET /analisis-financiero/evolucion?meses=6
   * meses defaults to 6 if not provided.
   */
  @Get('evolucion')
  getEvolucion(@User() user: any, @Query('meses') mesesQuery?: string) {
    const meses = mesesQuery
      ? Math.min(Math.max(parseInt(mesesQuery, 10) || 6, 1), 24)
      : 6;
    return this.service.getEvolucion(user.empresaId, meses);
  }

  /** GET /analisis-financiero/gastos?mes=&anio= */
  @Get('gastos')
  listarGastos(@User() user: any, @Query() query: QueryPeriodoDto) {
    return this.service.listarGastos(user.empresaId, query.mes, query.anio);
  }

  /** GET /analisis-financiero/gastos/historial */
  @Get('gastos/historial')
  historialGastos(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    return this.service.historialGastos(user.empresaId, fechaInicio, fechaFin);
  }

  /** POST /analisis-financiero/gastos */
  @Post('gastos')
  crearGasto(@User() user: any, @Body() dto: CrearGastoDto) {
    return this.service.crearGasto(user.empresaId, dto);
  }

  /** PATCH /analisis-financiero/gastos/:id */
  @Patch('gastos/:id')
  actualizarGasto(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarGastoDto,
  ) {
    return this.service.actualizarGasto(user.empresaId, id, dto);
  }

  /** GET /analisis-financiero/categorias?mes=&anio= */
  @Get('categorias')
  getRentabilidadCategorias(
    @User() user: any,
    @Query() query: QueryPeriodoDto,
  ) {
    return this.service.getRentabilidadCategorias(
      user.empresaId,
      query.mes,
      query.anio,
    );
  }

  /** GET /analisis-financiero/metodos-pago?mes=&anio=&fechaInicio=&fechaFin= */
  @Get('metodos-pago')
  getMetodosPago(
    @User() user: any,
    @Query('mes') mes?: string,
    @Query('anio') anio?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    return this.service.getMetodosPago(
      user.empresaId,
      mes ? Number(mes) : undefined,
      anio ? Number(anio) : undefined,
      fechaInicio,
      fechaFin,
    );
  }

  /** DELETE /analisis-financiero/gastos/:id */
  @Delete('gastos/:id')
  eliminarGasto(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.eliminarGasto(user.empresaId, id);
  }
}
