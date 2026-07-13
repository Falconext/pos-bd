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
import { GeocercasService } from './geocercas.service';
import { CreateGeocercaDto } from './dto/create-geocerca.dto';
import { UpdateGeocercaDto } from './dto/update-geocerca.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/geocercas')
export class GeocercasController {
  constructor(private readonly geocercasService: GeocercasService) {}

  @Post()
  create(@Body() dto: CreateGeocercaDto, @Request() req: any) {
    return this.geocercasService.create(req.user.empresaId, dto);
  }

  @Get()
  findAll(@Request() req: any, @Query('activo') activo?: string) {
    return this.geocercasService.findAll(req.user.empresaId, {
      activo: activo === undefined ? undefined : activo === 'true',
    });
  }

  @Get('eventos')
  eventos(
    @Request() req: any,
    @Query('geocercaId') geocercaId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.geocercasService.eventos(req.user.empresaId, {
      geocercaId: geocercaId ? Number(geocercaId) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('resumen')
  resumen(@Request() req: any) {
    return this.geocercasService.resumen(req.user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.geocercasService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGeocercaDto,
    @Request() req: any,
  ) {
    return this.geocercasService.update(id, req.user.empresaId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.geocercasService.remove(id, req.user.empresaId);
  }
}
