import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { CombustibleService } from './combustible.service';
import { CreateCombustibleDto } from './dto/create-combustible.dto';
import { UpdateCombustibleDto } from './dto/update-combustible.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/combustibles')
export class CombustibleController {
  constructor(private readonly combustibleService: CombustibleService) {}

  @Post()
  create(@Body() dto: CreateCombustibleDto, @Request() req: any) {
    return this.combustibleService.create(req.user.empresaId, dto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('vehiculoId') vehiculoId?: string,
  ) {
    return this.combustibleService.findAll(req.user.empresaId, {
      search,
      vehiculoId: vehiculoId ? Number(vehiculoId) : undefined,
    });
  }

  @Get('resumen')
  resumen(@Request() req: any) {
    return this.combustibleService.resumen(req.user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.combustibleService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCombustibleDto,
    @Request() req: any,
  ) {
    return this.combustibleService.update(id, req.user.empresaId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.combustibleService.remove(id, req.user.empresaId);
  }
}
