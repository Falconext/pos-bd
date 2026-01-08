import {
    Controller,
    Get,
    Post,
    Body,
    Query,
    UseGuards,
    Request,
    Put,
    Param,
    Delete,
} from '@nestjs/common';
import { ClienteService } from './cliente.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PersonaType } from '@prisma/client';

@Controller('proveedores')
@UseGuards(JwtAuthGuard)
export class ProveedoresController {
    constructor(private readonly clienteService: ClienteService) { }

    @Get()
    async listar(
        @Request() req,
        @Query('search') search: string,
        @Query('page') page: number,
        @Query('limit') limit: number,
    ) {
        return this.clienteService.listar({
            empresaId: req.user.empresaId,
            search,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 10,
            persona: PersonaType.PROVEEDOR,
        });
    }

    @Post()
    async crear(@Request() req, @Body() body: any) {
        return this.clienteService.crear({
            ...body,
            empresaId: req.user.empresaId,
            persona: PersonaType.PROVEEDOR,
        });
    }

    @Put(':id')
    async actualizar(
        @Request() req,
        @Param('id') id: string,
        @Body() body: any,
    ) {
        return this.clienteService.actualizar({
            id: Number(id),
            empresaId: req.user.empresaId,
            ...body,
            persona: PersonaType.PROVEEDOR,
        });
    }
}
