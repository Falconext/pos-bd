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
import { AlmacenLogisticaService } from './almacen.service';
import { CreateAlmacenLogisticaDto } from './dto/create-almacen.dto';
import { UpdateAlmacenLogisticaDto } from './dto/update-almacen.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('logistica/almacenes')
export class AlmacenLogisticaController {
  constructor(private readonly almacenService: AlmacenLogisticaService) {}

  @Post()
  create(
    @Body() createAlmacenDto: CreateAlmacenLogisticaDto,
    @Request() req: any,
  ) {
    return this.almacenService.create(req.user.empresaId, createAlmacenDto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('activo') activo?: string,
  ) {
    const isActivo =
      activo === 'true' ? true : activo === 'false' ? false : undefined;
    return this.almacenService.findAll(req.user.empresaId, {
      search,
      activo: isActivo,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.almacenService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAlmacenDto: UpdateAlmacenLogisticaDto,
    @Request() req: any,
  ) {
    return this.almacenService.update(id, req.user.empresaId, updateAlmacenDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.almacenService.remove(id, req.user.empresaId);
  }
}
