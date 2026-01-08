import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { ComprasService } from './compras.service';
import { CrearCompraDto } from './dto/crear-compra.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('compras')
@UseGuards(JwtAuthGuard)
export class ComprasController {
    constructor(private readonly comprasService: ComprasService) { }

    @Post()
    async crear(@Request() req, @Body() body: CrearCompraDto) {
        return this.comprasService.crear(req.user.empresaId, req.user.id, body);
    }

    @Get()
    async listar(@Request() req, @Query() query) {
        return this.comprasService.listar(req.user.empresaId, query);
    }

    @Get(':id')
    async obtenerPorId(@Request() req, @Param('id', ParseIntPipe) id: number) {
        return this.comprasService.obtenerPorId(req.user.empresaId, id);
    }
    @Post(':id/pagos')
    async registrarPago(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
        return this.comprasService.registrarPago(req.user.empresaId, req.user.id, id, body);
    }

    @Get(':id/pagos')
    async historialPagos(@Request() req, @Param('id', ParseIntPipe) id: number) {
        return this.comprasService.getHistorialPagos(req.user.empresaId, id);
    }
}
