import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import {
  sedeIdParaListado,
  usuarioIdParaListado,
} from '../common/utils/alcance-lectura';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ventas')
export class VentasController {
  constructor(private readonly service: VentasService) {}

  @Get('panel')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async panel(
    @User() user: any,
    @Query('fecha') fecha: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeId?: string,
    @Query('usuarioId') usuarioId?: string,
  ) {
    const fechaFinal =
      fecha ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    // El supervisor (convertirEnSupervisor) lee las ventas de todos y de todas
    // las sedes, igual que ya lo trataba el dashboard. Es solo lectura: no le
    // habilita anular ni editar nada.
    return this.service.panelVentas({
      empresaId: user.empresaId,
      fecha: fechaFinal,
      // Rango opcional: si no llega fechaFin, el panel sigue siendo de un solo día
      fechaFin: fechaFin || undefined,
      sedeId: sedeIdParaListado(user, sedeId),
      usuarioId: usuarioIdParaListado(user, usuarioId),
    });
  }
}
