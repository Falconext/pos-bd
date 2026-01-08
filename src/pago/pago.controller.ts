import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  ParseIntPipe,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PagoService } from './pago.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { User } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pago')
export class PagoController {
  constructor(private readonly service: PagoService) { }

  @Get('listar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(
    @User() user: any,
    @Query('clienteId') clienteId?: string,
    @Query('estadoPago') estadoPago?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('medioPago') medioPago?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listarTodos({
      empresaId: user.empresaId,
      clienteId: clienteId ? Number(clienteId) : undefined,
      estadoPago,
      fechaInicio,
      fechaFin,
      medioPago,
      search,
    });
  }

  @Get('reporte')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async reporte(
    @User() user: any,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
  ) {
    return this.service.reportePorPeriodo(
      user.empresaId,
      fechaInicio,
      fechaFin,
    );
  }

  @Post('comprobante/:comprobanteId/registrar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async registrarPago(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @Body() dto: CrearPagoDto,
    @User() user: any,
  ) {
    return this.service.registrarPago(
      comprobanteId,
      dto,
      user.id,
      user.empresaId,
    );
  }

  @Get('comprobante/:comprobanteId/historial')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerPagos(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
  ) {
    return this.service.obtenerPagos(comprobanteId);
  }

  @Delete(':pagoId/reversar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async reversarPago(
    @Param('pagoId', ParseIntPipe) pagoId: number,
    @User() user: any,
  ) {
    return this.service.reversarPago(pagoId, user.empresaId);
  }

  @Post('comprobante/:comprobanteId/recalcular')
  @Roles('ADMIN_EMPRESA')
  async recalcularSaldo(
    @Param('comprobanteId', ParseIntPipe) comprobanteId: number,
    @User() user: any,
  ) {
    return this.service.recalcularSaldoComprobante(comprobanteId, user.empresaId);
  }

  @Post('recalcular-todos')
  @Roles('ADMIN_EMPRESA')
  async recalcularTodos(@User() user: any) {
    return this.service.recalcularTodosSaldos(user.empresaId);
  }
}
