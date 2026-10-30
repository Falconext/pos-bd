import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { RegularizarAfectacionService } from './regularizar-afectacion.service';

/**
 * Regularizar comprobantes emitidos con la afectación de IGV equivocada
 * (FRUTA PURA, 30-10). Solo el equipo de Krezka: emite en SUNAT a nombre de
 * la empresa.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN_SISTEMA')
@Controller('comprobante/regularizar-afectacion')
export class RegularizarAfectacionController {
  constructor(private readonly regularizar: RegularizarAfectacionService) {}

  /** Lista lo que hay que regularizar. No emite nada. */
  @Get(':empresaId')
  planear(@Param('empresaId', ParseIntPipe) empresaId: number) {
    return this.regularizar.planear(empresaId);
  }

  /** Anula con nota de crédito y reemite. Exige `confirmar: true`. */
  @Post(':empresaId')
  ejecutar(
    @Param('empresaId', ParseIntPipe) empresaId: number,
    @Body() body: { ids?: number[]; confirmar?: boolean },
    @User() user: any,
  ) {
    return this.regularizar.ejecutar(
      empresaId,
      (body?.ids ?? []).map(Number),
      body?.confirmar === true,
      user?.nombre ?? 'Sistema',
      user?.email ?? 'sistema@krezka',
    );
  }
}
