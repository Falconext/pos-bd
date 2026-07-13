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
import { MantenimientoService } from './mantenimiento.service';
import { CreateMantenimientoDto } from './dto/create-mantenimiento.dto';
import { UpdateMantenimientoDto } from './dto/update-mantenimiento.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/mantenimientos')
export class MantenimientoController {
  constructor(private readonly mantenimientoService: MantenimientoService) {}

  @Post()
  create(
    @Body() createMantenimientoDto: CreateMantenimientoDto,
    @Request() req: any,
  ) {
    return this.mantenimientoService.create(
      req.user.empresaId,
      createMantenimientoDto,
    );
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('estado') estado?: string,
    @Query('tipo') tipo?: string,
    @Query('vehiculoId') vehiculoId?: string,
  ) {
    return this.mantenimientoService.findAll(req.user.empresaId, {
      search,
      estado,
      tipo,
      vehiculoId: vehiculoId ? Number(vehiculoId) : undefined,
    });
  }

  @Get('resumen')
  resumen(@Request() req: any) {
    return this.mantenimientoService.resumen(req.user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.mantenimientoService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMantenimientoDto: UpdateMantenimientoDto,
    @Request() req: any,
  ) {
    return this.mantenimientoService.update(
      id,
      req.user.empresaId,
      updateMantenimientoDto,
    );
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.mantenimientoService.remove(id, req.user.empresaId);
  }
}
