import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { VehiculoService } from './vehiculo.service';
import { CreateVehiculoDto } from './dto/create-vehiculo.dto';
import { UpdateVehiculoDto } from './dto/update-vehiculo.dto';
import { CreateActaDto } from './dto/create-acta.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('vehiculos')
export class VehiculoController {
  constructor(private readonly vehiculoService: VehiculoService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const empresaId = req.user.empresaId;
    return this.vehiculoService.findAll(empresaId, {
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.vehiculoService.findOne(id, req.user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateVehiculoDto, @Request() req: any) {
    return this.vehiculoService.create(
      req.user.empresaId,
      dto,
      req.user.sedeId ?? undefined,
    );
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVehiculoDto,
    @Request() req: any,
  ) {
    return this.vehiculoService.update(id, req.user.empresaId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.vehiculoService.remove(id, req.user.empresaId);
  }

  // ─── Actas de Inspección ──────────────────────────────────────────────────

  @Get(':id/actas')
  findActas(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.vehiculoService.findActas(id, req.user.empresaId);
  }

  @Post(':id/acta')
  createActa(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateActaDto,
    @Request() req: any,
  ) {
    return this.vehiculoService.createActa(
      id,
      req.user.empresaId,
      req.user.sub,
      dto,
    );
  }
}
