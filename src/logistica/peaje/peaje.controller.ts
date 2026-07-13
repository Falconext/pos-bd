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
import { PeajeService } from './peaje.service';
import { CreatePeajeDto } from './dto/create-peaje.dto';
import { UpdatePeajeDto } from './dto/update-peaje.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/peajes')
export class PeajeController {
  constructor(private readonly peajeService: PeajeService) {}

  @Post()
  create(@Body() dto: CreatePeajeDto, @Request() req: any) {
    return this.peajeService.create(req.user.empresaId, dto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
    @Query('vehiculoId') vehiculoId?: string,
  ) {
    return this.peajeService.findAll(req.user.empresaId, {
      search,
      tipo,
      estado,
      vehiculoId: vehiculoId ? Number(vehiculoId) : undefined,
    });
  }

  @Get('resumen')
  resumen(@Request() req: any) {
    return this.peajeService.resumen(req.user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.peajeService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePeajeDto,
    @Request() req: any,
  ) {
    return this.peajeService.update(id, req.user.empresaId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.peajeService.remove(id, req.user.empresaId);
  }
}
