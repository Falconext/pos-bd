import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { User } from '../common/decorators/user.decorator';
import { ReporteDiarioService } from './reporte-diario.service';

/** Reporte diario por WhatsApp al dueño: solo para quien tiene IA de Ventas. */
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('leads')
@Controller('leads/reporte-diario')
export class ReporteDiarioController {
  constructor(private readonly service: ReporteDiarioService) {}

  @Get()
  estado(@User() user: any) {
    return this.service.estado(user.empresaId);
  }

  @Patch()
  activar(@User() user: any, @Body() body: { activo?: boolean }) {
    return this.service.activar(user.empresaId, body?.activo === true);
  }

  /** Manda ahora el de hoy, para ver cómo llega. */
  @Post('probar')
  probar(@User() user: any) {
    return this.service.probar(user.empresaId);
  }
}
