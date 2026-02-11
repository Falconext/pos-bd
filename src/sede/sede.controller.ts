import { Controller, Get, Post, Body, Patch, Param, Delete, Request, UseGuards } from '@nestjs/common';
import { SedeService } from './sede.service';
import { CreateSedeDto } from './dto/create-sede.dto';
import { UpdateSedeDto } from './dto/update-sede.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('sede')
export class SedeController {
    constructor(private readonly sedeService: SedeService) { }

    @Post()
    create(@Body() createSedeDto: CreateSedeDto, @Request() req) {
        return this.sedeService.create(createSedeDto, req.user.empresaId);
    }

    @Get()
    findAll(@Request() req) {
        return this.sedeService.findAll(req.user.empresaId);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.sedeService.findOne(+id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateSedeDto: UpdateSedeDto, @Request() req) {
        return this.sedeService.update(+id, updateSedeDto, req.user.empresaId);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.sedeService.remove(+id);
    }
}
