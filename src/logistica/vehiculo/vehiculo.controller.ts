import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { VehiculoLogisticaService } from './vehiculo.service';
import { CreateVehiculoLogisticaDto } from './dto/create-vehiculo.dto';
import { UpdateVehiculoLogisticaDto } from './dto/update-vehiculo.dto';
import { CreateTipoVehiculoDto } from './dto/create-tipo-vehiculo.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/vehiculos')
export class VehiculoLogisticaController {
  constructor(private readonly vehiculoService: VehiculoLogisticaService) {}

  // ── Tipos de vehículo (dato maestro de la flota) ──
  // Deben ir ANTES de las rutas ':id' para no ser capturadas por el ParseIntPipe.
  @Get('tipos')
  listarTipos(@Request() req: any) {
    return this.vehiculoService.listarTipos(req.user.empresaId);
  }

  @Post('tipos')
  crearTipo(@Body() dto: CreateTipoVehiculoDto, @Request() req: any) {
    return this.vehiculoService.crearTipo(req.user.empresaId, dto);
  }

  @Post()
  create(
    @Body() createVehiculoDto: CreateVehiculoLogisticaDto,
    @Request() req: any,
  ) {
    return this.vehiculoService.create(req.user.empresaId, createVehiculoDto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('estado') estado?: string,
  ) {
    return this.vehiculoService.findAll(req.user.empresaId, { search, estado });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.vehiculoService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateVehiculoDto: UpdateVehiculoLogisticaDto,
    @Request() req: any,
  ) {
    return this.vehiculoService.update(
      id,
      req.user.empresaId,
      updateVehiculoDto,
    );
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.vehiculoService.remove(id, req.user.empresaId);
  }
}
