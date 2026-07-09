import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { PedidoLogisticaService } from './pedido.service';
import { CreatePedidoLogisticaDto } from './dto/create-pedido.dto';
import { UpdateEstadoPedidoDto } from './dto/update-estado-pedido.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('logistica/pedidos')
export class PedidoLogisticaController {
  constructor(private readonly pedidoService: PedidoLogisticaService) {}

  @Post()
  create(
    @Body() createPedidoDto: CreatePedidoLogisticaDto,
    @Request() req: any,
  ) {
    return this.pedidoService.create(req.user.empresaId, createPedidoDto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('estado') estado?: string,
  ) {
    return this.pedidoService.findAll(req.user.empresaId, { search, estado });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.pedidoService.findOne(id, req.user.empresaId);
  }

  @Patch(':id/estado')
  updateEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateEstadoDto: UpdateEstadoPedidoDto,
    @Request() req: any,
  ) {
    return this.pedidoService.updateEstado(
      id,
      req.user.empresaId,
      req.user.sub,
      updateEstadoDto,
    );
  }
}
