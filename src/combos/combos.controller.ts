import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseIntPipe, Query, Req } from '@nestjs/common';
import { CombosService } from './combos.service';
import { CreateComboDto, UpdateComboDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('combos')
@UseGuards(JwtAuthGuard)
export class CombosController {
    constructor(private readonly combosService: CombosService) { }

    @Post()
    create(@Req() req: any, @Body() createComboDto: CreateComboDto) {
        return this.combosService.create(req.user.empresaId, createComboDto);
    }

    @Get()
    findAll(
        @Req() req: any,
        @Query('includeInactive') includeInactive?: string
    ) {
        return this.combosService.findAll(req.user.empresaId, includeInactive === 'true');
    }

    @Get(':id')
    findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.combosService.findOne(id, req.user.empresaId);
    }

    @Get(':id/stock')
    checkStock(@Param('id', ParseIntPipe) id: number) {
        return this.combosService.checkStock(id);
    }

    @Patch(':id')
    update(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
        @Body() updateComboDto: UpdateComboDto
    ) {
        return this.combosService.update(id, req.user.empresaId, updateComboDto);
    }

    @Delete(':id')
    delete(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.combosService.delete(id, req.user.empresaId);
    }
}
