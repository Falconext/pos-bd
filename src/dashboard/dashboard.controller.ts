import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  private resolveSedeId(user: any, sedeIdQuery?: string): number | undefined {
    const isAdmin =
      user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA';
    if (isAdmin) {
      return sedeIdQuery ? Number(sedeIdQuery) : undefined;
    }
    return user.sedeId ?? undefined;
  }

  @Get('dashboard')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async resumen(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const sedeId = this.resolveSedeId(user, sedeIdQuery);
    const data = await this.service.headerResumen(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
    return data;
  }

  @Get('overview')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async overview(
    @User() user: any,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const sedeId = this.resolveSedeId(user, sedeIdQuery);
    const data = await this.service.overview(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
    return data;
  }

  @Get('ingresos-por-fecha-comprobante')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async ingresosPorComprobante(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const sedeId = this.resolveSedeId(user, sedeIdQuery);
    const data = await this.service.ingresosPorComprobante(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
    return data;
  }

  @Get('ingresos-por-fecha-medio-pago')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async ingresosPorMedioPago(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const sedeId = this.resolveSedeId(user, sedeIdQuery);
    const data = await this.service.ingresosPorMedioPago(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
    return data;
  }

  @Get('top-productos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async topProductos(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('limit') limitRaw?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const limit = limitRaw ? Number(limitRaw) : 10;
    const sedeId = this.resolveSedeId(user, sedeIdQuery);
    const data = await this.service.topProductos(
      user.empresaId,
      fechaInicio,
      fechaFin,
      limit,
      sedeId,
    );
    return data;
  }

  @Get('nuevos-clientes-por-fecha')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async clientesNuevos(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const sedeId = this.resolveSedeId(user, sedeIdQuery);
    const data = await this.service.clientesNuevos(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
    return data;
  }
}
