import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { User } from '../common/decorators/user.decorator';
import { MetaConversionesService } from './meta-conversiones.service';

/** Avisar a Meta las ventas que trajo cada anuncio (API de Conversiones). */
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('leads')
@Controller('leads/meta-conversiones')
export class MetaConversionesController {
  constructor(private readonly service: MetaConversionesService) {}

  @Get()
  estado(@User() user: any) {
    return this.service.estado(user.empresaId);
  }

  @Patch()
  activar(@User() user: any, @Body() body: { activo?: boolean }) {
    return this.service.activar(user.empresaId, body?.activo === true);
  }

  /** Revisa la conexión con Meta y manda lo pendiente; con código, una compra de prueba. */
  @Post('probar')
  probar(@User() user: any, @Body() body: { testEventCode?: string }) {
    const codigo = typeof body?.testEventCode === 'string' ? body.testEventCode.slice(0, 40) : undefined;
    return this.service.probar(user.empresaId, codigo);
  }
}
