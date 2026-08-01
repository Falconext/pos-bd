import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrdenCompraService } from './orden-compra.service';
import {
  ActualizarOrdenCompraDto,
  CrearOrdenCompraDto,
  RecibirOrdenCompraDto,
} from './dto/orden-compra.dto';

@Controller('compras/ordenes')
@UseGuards(JwtAuthGuard)
export class OrdenCompraController {
  constructor(private readonly service: OrdenCompraService) {}

  @Post()
  async crear(@Request() req, @Body() body: CrearOrdenCompraDto) {
    return this.service.crear(
      req.user.empresaId,
      req.user.id,
      body,
      req.user.sedeId,
    );
  }

  @Get()
  async listar(@Request() req, @Query() query) {
    return this.service.listar(req.user.empresaId, query);
  }

  @Get(':id')
  async obtener(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.obtener(req.user.empresaId, id);
  }

  @Get(':id/pdf')
  async pdf(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const file = await this.service.pdf(req.user.empresaId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.end(file.buffer);
  }

  @Put(':id')
  async actualizar(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ActualizarOrdenCompraDto,
  ) {
    return this.service.actualizar(req.user.empresaId, id, body);
  }

  @Patch(':id/anular')
  async anular(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.anular(req.user.empresaId, id);
  }

  @Post(':id/recibir')
  async recibir(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RecibirOrdenCompraDto,
  ) {
    return this.service.recibir(
      req.user.empresaId,
      req.user.id,
      id,
      body,
      req.user.sedeId,
    );
  }
}
