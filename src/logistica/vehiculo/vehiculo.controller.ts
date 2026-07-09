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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('logistica/vehiculos')
export class VehiculoLogisticaController {
  constructor(private readonly vehiculoService: VehiculoLogisticaService) {}

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
