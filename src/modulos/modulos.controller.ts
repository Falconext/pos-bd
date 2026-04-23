import { Controller, Get, Param, ParseIntPipe, Post, Body, Put, Delete, Query } from '@nestjs/common';
import { ModulosService } from './modulos.service';
import { CreateSubModuloDto } from './dto/create-submodulo.dto';
import { UpdateSubModuloDto } from './dto/update-submodulo.dto';

@Controller('modulos')
export class ModulosController {
    constructor(private readonly modulosService: ModulosService) { }

    @Get()
    findAll(@Query('admin') admin?: string) {
        return admin === 'true'
            ? this.modulosService.findAllAdmin()
            : this.modulosService.findAll();
    }

    // Rutas literales antes que las parametrizadas para evitar conflictos

    @Get('codigo/:codigo')
    findByCodigo(@Param('codigo') codigo: string) {
        return this.modulosService.findByCodigo(codigo);
    }

    @Post('submodulos')
    createSubModulo(@Body() dto: CreateSubModuloDto) {
        return this.modulosService.createSubModulo(dto);
    }

    @Put('submodulos/:id')
    updateSubModulo(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateSubModuloDto,
    ) {
        return this.modulosService.updateSubModulo(id, dto);
    }

    @Delete('submodulos/:id')
    removeSubModulo(@Param('id', ParseIntPipe) id: number) {
        return this.modulosService.removeSubModulo(id);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.modulosService.findOne(id);
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
