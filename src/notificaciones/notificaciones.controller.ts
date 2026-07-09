import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { NotificacionesService } from './notificaciones.service';
import { InventarioNotificacionesService } from './inventario-notificaciones.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notificaciones')
export class NotificacionesController {
  constructor(
    private readonly notificacionesService: NotificacionesService,
    private readonly inventarioNotificacionesService: InventarioNotificacionesService,
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
}
