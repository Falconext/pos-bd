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
import { RegistrarEntregaDto } from './dto/registrar-entrega.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
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

  /** Confirma la entrega con su prueba (receptor, firma, fotos, COD). */
  @Post(':id/entrega')
  confirmarEntrega(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegistrarEntregaDto,
    @Request() req: any,
  ) {
    return this.pedidoService.confirmarEntrega(
      id,
      req.user.empresaId,
      req.user.sub,
      dto,
    );
  }
}
