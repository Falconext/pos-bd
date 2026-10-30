import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { SuscripcionService } from './suscripcion.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('suscripcion')
export class SuscripcionController {
  constructor(private readonly service: SuscripcionService) {}

  @Get('mi')
  @Roles('ADMIN_EMPRESA')
  async verMiSuscripcion(@User() user: any) {
    const data = await this.service.verMiSuscripcion(user.empresaId);
    return { code: 1, data };
  }

  /** Prueba gratis de IA de Ventas: planes para elegir y el sugerido. */
  @Get('planes-ventas')
  @Roles('ADMIN_EMPRESA')
  planesVentas(@User() user: any) {
    // Sin envolver: el ResponseInterceptor ya arma { code, message, data }.
    return this.service.planesVentasParaElegir(user.empresaId);
  }

  @Post('elegir-plan-ventas')
  @Roles('ADMIN_EMPRESA')
  elegirPlanVentas(@User() user: any, @Body() body: { plan?: string }) {
    return this.service.elegirPlanVentas(user.empresaId, String(body?.plan ?? ''));
  }

  @Get('uso-plan')
  @Roles('ADMIN_EMPRESA')
  async verUsoPlan() {
    return { code: 0, message: 'No implementado' };
  }

  @Post('cambiar-plan')
  @Roles('ADMIN_EMPRESA')
  async cambiarPlan(@Body() _body: any) {
    return { code: 0, message: 'No implementado' };
  }

  @Post('renovar')
  @Roles('ADMIN_EMPRESA')
  async renovar(@Body() _body: any) {
    return { code: 0, message: 'No implementado' };
  }
}
