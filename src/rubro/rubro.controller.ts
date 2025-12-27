import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RubroService } from './rubro.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('rubro')
export class RubroController {
    constructor(private readonly rubroService: RubroService) { }

    @Get()
    // @UseGuards(JwtAuthGuard) // Optional: secure if needed, but catalogs usually public or authenticated
    async findAll() {
        return this.rubroService.findAll();
    }

    @Get(':id')
    async findOne(@Param('id', ParseIntPipe) id: number) {
        return this.rubroService.findOne(id);
    }
}
