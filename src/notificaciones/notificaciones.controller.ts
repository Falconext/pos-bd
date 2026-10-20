import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Post,
  Put,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { NotificacionesService } from './notificaciones.service';
import { InventarioNotificacionesService } from './inventario-notificaciones.service';
import { AlertaStockService } from './alerta-stock.service';
import { AlertaStockConfigDto } from './dto/alerta-stock-config.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notificaciones')
export class NotificacionesController {
  constructor(
    private readonly notificacionesService: NotificacionesService,
    private readonly inventarioNotificacionesService: InventarioNotificacionesService,
    private readonly alertaStock: AlertaStockService,
  ) {}

  @Get()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerNotificaciones(@User() user: any) {
    return await this.notificacionesService.obtenerNotificacionesUsuario(
      user.id,
    );
  }

  @Patch('leer-todas')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async marcarTodasComoLeidas(@User() user: any) {
    return await this.notificacionesService.marcarTodasComoLeidas(user.id);
  }

  @Patch(':id/leer')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async marcarComoLeida(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return await this.notificacionesService.marcarComoLeida(id, user.id);
  }

  @Get('verificar-suscripciones')
  @Roles('ADMIN_SISTEMA')
  async verificarSuscripciones() {
    return await this.notificacionesService.verificarSuscripcionesProximasVencer();
  }

  @Get('verificar-inventario')
  @Roles('ADMIN_EMPRESA')
  async verificarInventario(@User() user: any) {
    return await this.inventarioNotificacionesService.verificarInventarioEmpresa(
      user.empresaId,
    );
  }

  // ── Resumen de stock bajo por correo/WhatsApp ──
  @Get('alertas-stock')
  @Roles('ADMIN_EMPRESA')
  async configAlertaStock(@User() user: any) {
    return this.alertaStock.obtenerConfig(user.empresaId);
  }

  @Put('alertas-stock')
  @Roles('ADMIN_EMPRESA')
  async guardarAlertaStock(@User() user: any, @Body() dto: AlertaStockConfigDto) {
    return this.alertaStock.guardarConfig(user.empresaId, dto);
  }

  /** Lo que saldría hoy, sin mandar nada. */
  @Get('alertas-stock/productos')
  @Roles('ADMIN_EMPRESA')
  async productosAlertaStock(@User() user: any) {
    return this.alertaStock.productosBajoMinimo(user.empresaId);
  }

  /** "Enviar ahora": manda el resumen aunque ya haya salido hoy. */
  @Post('alertas-stock/enviar')
  @Roles('ADMIN_EMPRESA')
  async enviarAlertaStock(@User() user: any) {
    return this.alertaStock.enviarResumen(user.empresaId, { forzar: true });
  }
}
