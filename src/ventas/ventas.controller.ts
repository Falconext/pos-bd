import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ventas')
export class VentasController {
    constructor(private readonly service: VentasService) {}

    @Get('panel')
    @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
    async panel(
        @User() user: any,
        @Query('fecha') fecha: string,
        @Query('sedeId') sedeId?: string,
    ) {
        const fechaFinal = fecha || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
        return this.service.panelVentas({
            empresaId: user.empresaId,
            fecha: fechaFinal,
            sedeId: sedeId ? Number(sedeId) : undefined,
        });
    }
}
