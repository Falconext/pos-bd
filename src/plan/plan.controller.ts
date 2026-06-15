import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards, ParseIntPipe, Query } from '@nestjs/common';
import { PlanService } from './plan.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@Controller('plan')
export class PlanController {
    constructor(private readonly planService: PlanService) { }

    @Get('public')
    findPublic(
        @Query('producto') producto?: string,
        @Query('plataforma') plataforma?: string,
    ) {
        return this.planService.findPublicPlans(producto, plataforma);
    }

    @Get('features/catalog')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    featureCatalog() {
        return this.planService.getFeatureCatalog();
    }

    @Get()
    findAll(
        @Query('producto') producto?: string,
        @Query('plataforma') plataforma?: string,
        @User() user?: any,
    ) {
        const plataformaScope = user?.sistemaNegocio
            ? String(user.sistemaNegocio).toLowerCase()
            : plataforma;
        return this.planService.findAll(producto, plataformaScope);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.planService.findOne(id);
    }

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    create(@Body() createPlanDto: CreatePlanDto, @User() user?: any) {
        const payload = user?.sistemaNegocio
            ? { ...createPlanDto, plataforma: String(user.sistemaNegocio).toLowerCase() as 'falconext' | 'krezka' }
            : createPlanDto;
        return this.planService.create(payload);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    update(@Param('id', ParseIntPipe) id: number, @Body() updatePlanDto: UpdatePlanDto, @User() user?: any) {
        const payload = user?.sistemaNegocio
            ? { ...updatePlanDto, plataforma: String(user.sistemaNegocio).toLowerCase() as 'falconext' | 'krezka' }
            : updatePlanDto;
        return this.planService.update(id, payload);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN_SISTEMA')
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.planService.remove(id);
    }
}
