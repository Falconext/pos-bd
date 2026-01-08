import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@Controller('finanzas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanzasController {
    constructor(private readonly finanzasService: FinanzasService) { }

    @Get('resumen')
    @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
    async getResumen(
        @User() user: any,
        @Query('fechaInicio') fechaInicio?: string,
        @Query('fechaFin') fechaFin?: string,
    ) {
        const empresaId = user.empresaId;
        return this.finanzasService.getResumenFinanciero(
            empresaId,
            fechaInicio,
            fechaFin,
        );
    }
}
