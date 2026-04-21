import { Controller, Get, Post, Body, Param, UseGuards, Request, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ResellerService } from './reseller.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@Controller('resellers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResellerController {
    constructor(private readonly resellerService: ResellerService) { }

    @Roles('ADMIN_SISTEMA')
    @Post()
    create(@Body() createDto: { nombre: string; email: string; codigo: string; telefono?: string }) {
        return this.resellerService.create(createDto);
    }

    @Roles('ADMIN_SISTEMA')
    @Get()
    findAll() {
        return this.resellerService.findAll();
    }

    @Roles('ADMIN_SISTEMA')
    @Get('rentabilidad')
    getProfitabilityOverview(@Query('days') days?: string) {
        const period = Number(days ?? 30);
        return this.resellerService.getProfitabilityOverview(Number.isFinite(period) ? period : 30);
    }

    @Roles('ADMIN_SISTEMA')
    @Post('renewals/run')
    runRenewalsNow() {
        return this.resellerService.processMonthlyRenewals();
    }

    @Roles('ADMIN_SISTEMA', 'RESELLER')
    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
        await this.resellerService.validateResellerAccess(req.user.id, req.user.rol, id);
        return this.resellerService.findOne(id);
    }

    @Roles('ADMIN_SISTEMA')
    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
        return this.resellerService.update(id, body);
    }

    @Roles('ADMIN_SISTEMA')
    @Patch(':id/estado')
    toggleEstado(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { activo: boolean },
    ) {
        return this.resellerService.toggleActiveStatus(id, body.activo);
    }

    @Roles('ADMIN_SISTEMA')
    @Post(':id/recargar')
    recargar(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { monto: number; referencia?: string },
        @Request() req: any,
    ) {
        const usuarioId = req.user.id;
        return this.resellerService.recargarSaldo(id, body.monto, usuarioId, body.referencia);
    }

    @Roles('ADMIN_SISTEMA', 'RESELLER')
    @Get(':id/dashboard')
    async getDashboard(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
        await this.resellerService.validateResellerAccess(req.user.id, req.user.rol, id);
        return this.resellerService.getDashboardStats(id);
    }

    @Roles('ADMIN_SISTEMA', 'RESELLER')
    @Get(':id/renovaciones')
    async getRenewalMovements(
        @Param('id', ParseIntPipe) id: number,
        @Query('estado') estado: string | undefined,
        @Request() req: any,
    ) {
        await this.resellerService.validateResellerAccess(req.user.id, req.user.rol, id);
        return this.resellerService.getRenewalMovements(id, estado);
    }

    @Roles('ADMIN_SISTEMA', 'RESELLER')
    @Post(':id/clientes')
    async createClient(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Request() req: any) {
        await this.resellerService.validateResellerAccess(req.user.id, req.user.rol, id);
        return this.resellerService.createClient(id, body);
    }

    @Roles('ADMIN_SISTEMA', 'RESELLER')
    @Get(':id/clientes/:clienteId')
    async getClientDetails(
        @Param('id', ParseIntPipe) id: number,
        @Param('clienteId', ParseIntPipe) clienteId: number,
        @Request() req: any,
    ) {
        await this.resellerService.validateResellerAccess(req.user.id, req.user.rol, id);
        return this.resellerService.getClientDetails(id, clienteId);
    }

    @Roles('ADMIN_SISTEMA', 'RESELLER')
    @Patch(':id/clientes/:clienteId/estado')
    async toggleClientStatus(
        @Param('id', ParseIntPipe) id: number,
        @Param('clienteId', ParseIntPipe) clienteId: number,
        @Body() body: { estado: 'ACTIVO' | 'INACTIVO' },
        @Request() req: any,
    ) {
        await this.resellerService.validateResellerAccess(req.user.id, req.user.rol, id);
        return this.resellerService.toggleClientStatus(id, clienteId, body.estado);
    }
}
