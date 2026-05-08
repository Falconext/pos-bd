import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    Query,
    UseGuards,
    Request,
    ParseIntPipe,
    Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { GuiaRemisionService } from './guia-remision.service';
import { CreateGuiaRemisionDto } from './dto/create-guia-remision.dto';
import { UpdateGuiaRemisionDto } from './dto/update-guia-remision.dto';
import { QueryGuiaRemisionDto } from './dto/query-guia-remision.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('guia-remision')
@UseGuards(JwtAuthGuard)
export class GuiaRemisionController {
    constructor(private readonly guiaRemisionService: GuiaRemisionService) { }

    @Post()
    create(@Body() createGuiaRemisionDto: CreateGuiaRemisionDto, @Request() req) {
        const empresaId = req.user.empresaId;
        const usuarioId = req.user.id;
        const sedeId = req.user.sedeId;
        return this.guiaRemisionService.create(createGuiaRemisionDto, empresaId, usuarioId, sedeId);
    }

    @Get()
    findAll(@Query() query: QueryGuiaRemisionDto, @Request() req) {
        const empresaId = req.user.empresaId;
        const isAdmin = ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'].includes(req.user.rol);
        // Admin puede pasar ?sedeId=X para filtrar, o dejar vacío para ver todas las sedes
        const sedeId = isAdmin ? (query.sedeId ?? null) : req.user.sedeId;
        return this.guiaRemisionService.findAll(query, empresaId, sedeId);
    }

    @Get('next-correlativo/:serie')
    getNextCorrelativo(@Param('serie') serie: string, @Request() req) {
        const empresaId = req.user.empresaId;
        return this.guiaRemisionService.getNextCorrelativo(serie, empresaId);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
        const empresaId = req.user.empresaId;
        const sedeId = req.user.sedeId;
        return this.guiaRemisionService.findOne(id, empresaId, sedeId);
    }

    @Patch(':id/estado-sunat')
    syncEstadoSunat(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: any,
        @Request() req,
    ) {
        const empresaId = req.user.empresaId;
        const sedeId = req.user.sedeId;
        return this.guiaRemisionService.syncEstadoSunat(id, body, empresaId, sedeId);
    }

    @Patch(':id')
    update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateGuiaRemisionDto: UpdateGuiaRemisionDto,
        @Request() req,
    ) {
        const empresaId = req.user.empresaId;
        const sedeId = req.user.sedeId;
        return this.guiaRemisionService.update(id, updateGuiaRemisionDto, empresaId, sedeId);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
        const empresaId = req.user.empresaId;
        const sedeId = req.user.sedeId;
        return this.guiaRemisionService.remove(id, empresaId, sedeId);
    }

    @Post(':id/enviar-sunat')
    enviarSunat(
        @Param('id', ParseIntPipe) id: number,
        @Request() req,
    ) {
        const empresaId = req.user.empresaId;
        const sedeId = req.user.sedeId;
        return this.guiaRemisionService.enviarSunat(
            id,
            empresaId,
            sedeId
        );
    }
    @Get(':id/pdf')
    async generarPdf(
        @Param('id', ParseIntPipe) id: number,
        @Request() req,
        @Res() res: Response,
    ) {
        const empresaId = req.user.empresaId;
        const sedeId = req.user.sedeId;
        const pdfBuffer = await this.guiaRemisionService.generarPdf(id, empresaId, sedeId);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename=guia-remision-${id}.pdf`,
            'Content-Length': pdfBuffer.length,
        });

        res.end(pdfBuffer);
    }
}
