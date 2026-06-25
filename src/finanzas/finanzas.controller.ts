import { Controller, Get, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@Controller('finanzas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanzasController {
    constructor(private readonly finanzasService: FinanzasService) { }

    @Get('ecommerce')
    @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
    async getResumenEcommerce(
        @User() user: any,
        @Query('fechaInicio') fechaInicio?: string,
        @Query('fechaFin') fechaFin?: string,
        @Query('sedeId') sedeIdQuery?: string,
    ) {
        const empresaId = user.empresaId;
        const isAdmin = user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA';
        const sedeId = isAdmin
            ? (sedeIdQuery ? Number(sedeIdQuery) : null)
            : (user.sedeId ?? null);

        return this.finanzasService.getResumenEcommerce(empresaId, fechaInicio, fechaFin, sedeId);
    }

    @Get('resumen')
    @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
    async getResumen(
        @User() user: any,
        @Query('fechaInicio') fechaInicio?: string,
        @Query('fechaFin') fechaFin?: string,
        @Query('sedeId') sedeIdQuery?: string,
    ) {
        const empresaId = user.empresaId;
        const isAdmin = user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA';
        const sedeId = isAdmin
            ? (sedeIdQuery ? Number(sedeIdQuery) : null)
            : (user.sedeId ?? null);
        return this.finanzasService.getResumenFinanciero(
            empresaId,
            fechaInicio,
            fechaFin,
            sedeId,
        );
    }
}
