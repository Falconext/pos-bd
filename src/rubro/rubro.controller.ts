import {
    Controller, Get, Post, Patch, Delete,
    Param, Body, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { RubroService } from './rubro.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('rubro')
export class RubroController {
    constructor(private readonly rubroService: RubroService) { }

    @Get()
    async findAll() {
        return this.rubroService.findAll();
    }

    @Get('features/catalog')
    async featureCatalog() {
        return this.rubroService.featureCatalog();
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        return this.rubroService.findOne(id);
    }

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    async create(@Body() body: { nombre: string }) {
        return this.rubroService.create(body.nombre);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { nombre: string },
    ) {
        return this.rubroService.update(id, body.nombre);
    }

    @Patch(':id/features')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    async updateFeatures(
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { features: Record<string, boolean> },
    ) {
        return this.rubroService.updateFeatures(id, body.features ?? {});
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    async remove(@Param('id', ParseIntPipe) id: number) {
        return this.rubroService.remove(id);
    }
}
