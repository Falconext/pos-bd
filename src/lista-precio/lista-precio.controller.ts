import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ListaPrecioService } from './lista-precio.service';
import { CreateListaPrecioDto } from './dto/create-lista-precio.dto';
import { UpdateListaPrecioDto } from './dto/update-lista-precio.dto';

// Gestión de listas de precio: solo el ADMIN_EMPRESA configura precios/asignaciones.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lista-precio')
export class ListaPrecioController {
  constructor(private readonly service: ListaPrecioService) {}

  @Post()
  @Roles('ADMIN_EMPRESA')
  create(@Body() dto: CreateListaPrecioDto, @Request() req) {
    return this.service.create(dto, req.user.empresaId);
  }

  @Get()
  @Roles('ADMIN_EMPRESA')
  findAll(@Request() req) {
    return this.service.findAll(req.user.empresaId);
  }

  @Get(':id')
  @Roles('ADMIN_EMPRESA')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.findOne(id, req.user.empresaId);
  }

  @Put(':id')
  @Roles('ADMIN_EMPRESA')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateListaPrecioDto,
    @Request() req,
  ) {
    return this.service.update(id, dto, req.user.empresaId);
  }

  @Delete(':id')
  @Roles('ADMIN_EMPRESA')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.remove(id, req.user.empresaId);
  }

  // Precios de un producto en todas las listas (panel de la ficha de producto).
  @Get('producto/:productoId')
  @Roles('ADMIN_EMPRESA')
  itemsDeProducto(
    @Param('productoId', ParseIntPipe) productoId: number,
    @Request() req,
  ) {
    return this.service.itemsDeProducto(productoId, req.user.empresaId);
  }

  @Put('producto/:productoId')
  @Roles('ADMIN_EMPRESA')
  upsertItemsDeProducto(
    @Param('productoId', ParseIntPipe) productoId: number,
    @Body()
    body: {
      entradas: Array<{
        listaPrecioId: number;
        presentacionCodigo?: string;
        precioUnitario: number;
        precioOferta?: number | null;
      }>;
    },
    @Request() req,
  ) {
    return this.service.upsertItemsDeProducto(
      productoId,
      req.user.empresaId,
      body.entradas || [],
    );
  }
}
