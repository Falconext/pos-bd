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
} from '@nestjs/common';
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
        return this.guiaRemisionService.create(createGuiaRemisionDto, empresaId, usuarioId);
    }

    @Get()
    findAll(@Query() query: QueryGuiaRemisionDto, @Request() req) {
        const empresaId = req.user.empresaId;
        return this.guiaRemisionService.findAll(query, empresaId);
    }

    @Get('next-correlativo/:serie')
    getNextCorrelativo(@Param('serie') serie: string, @Request() req) {
        const empresaId = req.user.empresaId;
        return this.guiaRemisionService.getNextCorrelativo(serie, empresaId);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
        const empresaId = req.user.empresaId;
        return this.guiaRemisionService.findOne(id, empresaId);
    }

    @Patch(':id')
    update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateGuiaRemisionDto: UpdateGuiaRemisionDto,
        @Request() req,
    ) {
        const empresaId = req.user.empresaId;
        return this.guiaRemisionService.update(id, updateGuiaRemisionDto, empresaId);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
        const empresaId = req.user.empresaId;
        return this.guiaRemisionService.remove(id, empresaId);
    }

    @Post(':id/enviar-sunat')
    enviarSunat(
        @Param('id', ParseIntPipe) id: number,
        @Request() req,
    ) {
        const empresaId = req.user.empresaId;
        return this.guiaRemisionService.enviarSunat(
            id,
            empresaId
        );
    }
}
