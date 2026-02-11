import { Controller, Get, Post, Body, Param, Put, UseGuards, Request, ParseIntPipe, Patch } from '@nestjs/common';
import { ResellerService } from './reseller.service';
// import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'; // Assuming this exists
// import { RolesGuard } from 'src/auth/roles.guard'; // Assuming this exists
// import { Roles } from 'src/auth/roles.decorator';

@Controller('resellers')
export class ResellerController {
    constructor(private readonly resellerService: ResellerService) { }

    // @UseGuards(JwtAuthGuard, RolesGuard)
    // @Roles('ADMIN_SISTEMA')
    @Post()
    create(@Body() createDto: { nombre: string; email: string; codigo: string; telefono?: string }) {
        return this.resellerService.create(createDto);
    }

    @Get()
    findAll() {
        return this.resellerService.findAll();
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.resellerService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
        return this.resellerService.update(id, body);
    }

    @Post(':id/recargar')
    recargar(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { monto: number; referencia?: string },
        // @Request() req,
    ) {
        // const usuarioId = req.user.userId;
        const usuarioId = 1; // Placeholder until Auth is integrated
        return this.resellerService.recargarSaldo(id, body.monto, usuarioId, body.referencia);
    }

    @Get(':id/dashboard')
    getDashboard(@Param('id', ParseIntPipe) id: number) {
        return this.resellerService.getDashboardStats(id);
    }

    @Post(':id/clientes')
    createClient(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
        return this.resellerService.createClient(id, body);
    }

    @Get(':id/clientes/:clienteId')
    getClientDetails(
        @Param('id', ParseIntPipe) id: number,
        @Param('clienteId', ParseIntPipe) clienteId: number
    ) {
        return this.resellerService.getClientDetails(id, clienteId);
    }

    @Patch(':id/clientes/:clienteId/estado')
    toggleClientStatus(
        @Param('id', ParseIntPipe) id: number,
        @Param('clienteId', ParseIntPipe) clienteId: number,
        @Body() body: { estado: 'ACTIVO' | 'INACTIVO' }
    ) {
        return this.resellerService.toggleClientStatus(id, clienteId, body.estado);
    }
}
