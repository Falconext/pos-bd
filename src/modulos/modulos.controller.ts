import { Controller, Get, Param, ParseIntPipe, Post, Body, Put, Delete } from '@nestjs/common';
import { ModulosService } from './modulos.service';

@Controller('modulos')
export class ModulosController {
    constructor(private readonly modulosService: ModulosService) { }

    @Get()
    findAll() {
        return this.modulosService.findAll();
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.modulosService.findOne(id);
    }

    @Get('codigo/:codigo')
    findByCodigo(@Param('codigo') codigo: string) {
        return this.modulosService.findByCodigo(codigo);
    }

    @Post()
    create(@Body() createModuloDto: any) {
        return this.modulosService.create(createModuloDto);
    }

    @Put(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() updateModuloDto: any) {
        return this.modulosService.update(id, updateModuloDto);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.modulosService.remove(id);
    }
}
