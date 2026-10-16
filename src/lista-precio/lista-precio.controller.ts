import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
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

  // OJO: las rutas literales van ANTES que `:id`, o ParseIntPipe revienta con
  // 400 al intentar leer "aplicables" como número.

  // Lo usa el POS, no el panel: por eso también lo ve el vendedor.
  @Get('aplicables')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  aplicables(@Request() req, @Query('clienteId') clienteId?: string) {
    return this.service.aplicables(
      req.user.empresaId,
      req.user.id,
      req.user.sedeId ?? undefined,
      clienteId ? Number(clienteId) : undefined,
    );
  }

  // Reordenar = cambiar quién gana cuando dos listas podrían aplicar.
  @Put('reordenar')
  @Roles('ADMIN_EMPRESA')
  reordenar(@Body() body: { ids: number[] }, @Request() req) {
    return this.service.reordenar(req.user.empresaId, body.ids || []);
  }

  // Reprecia las líneas ya cargadas cuando el cajero cambia de lista.
  @Post('precios-de-lineas')
  @HttpCode(200)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  preciosDeLineas(
    @Body()
    body: {
      listaPrecioId?: number;
      sedeId?: number;
      lineas: Array<{ productoId: number; presentacionCodigo?: string }>;
    },
    @Request() req,
  ) {
    return this.service.preciosDeLineas(
      req.user.empresaId,
      body.sedeId ?? req.user.sedeId ?? undefined,
      body.listaPrecioId,
      body.lineas || [],
    );
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
