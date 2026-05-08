import {
    Controller, Get, Post, Patch, Delete,
    Param, Body, Query, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { SistemaFinanzasService } from './sistema-finanzas.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { User } from 'src/common/decorators/user.decorator';

@Controller('sistema-finanzas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN_SISTEMA')
export class SistemaFinanzasController {
    constructor(private readonly service: SistemaFinanzasService) { }

    @Get('dashboard')
    getDashboard(@User() user: any) {
        return this.service.getDashboard(user.sistemaNegocio ?? null);
    }

    @Get('tendencia')
    getTendencia(@User() user: any, @Query('meses') meses?: string) {
        return this.service.getTendencia(meses ? Number(meses) : 12, user.sistemaNegocio ?? null);
    }

    @Get('gastos')
    listarGastos(
        @Query('desde') desde?: string,
        @Query('hasta') hasta?: string,
        @Query('categoria') categoria?: string,
    ) {
        return this.service.listarGastos({ desde, hasta, categoria });
    }

    @Post('gastos')
    crearGasto(@Body() body: {
        concepto: string; categoria: string; monto: number;
        fecha: string; descripcion?: string; recurrente?: boolean; periodicidad?: string;
    }) {
        return this.service.crearGasto(body);
    }

    @Patch('gastos/:id')
    actualizarGasto(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: any,
    ) {
        return this.service.actualizarGasto(id, body);
    }

    @Delete('gastos/:id')
    eliminarGasto(@Param('id', ParseIntPipe) id: number) {
        return this.service.eliminarGasto(id);
    }
}
