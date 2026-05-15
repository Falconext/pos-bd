import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards, ParseIntPipe, Query } from '@nestjs/common';
import { PlanService } from './plan.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('plan')
export class PlanController {
    constructor(private readonly planService: PlanService) { }

    @Get()
    findAll(@Query('producto') producto?: string) {
        return this.planService.findAll(producto);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.planService.findOne(id);
    }

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    create(@Body() createPlanDto: CreatePlanDto) {
        return this.planService.create(createPlanDto);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    update(@Param('id', ParseIntPipe) id: number, @Body() updatePlanDto: UpdatePlanDto) {
        return this.planService.update(id, updatePlanDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.planService.remove(id);
    }
}
