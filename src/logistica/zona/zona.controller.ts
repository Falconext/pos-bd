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
import { ZonaEntregaLogisticaService } from './zona.service';
import { CreateZonaEntregaLogisticaDto } from './dto/create-zona.dto';
import { UpdateZonaEntregaLogisticaDto } from './dto/update-zona.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/zonas')
export class ZonaEntregaLogisticaController {
  constructor(private readonly zonaService: ZonaEntregaLogisticaService) {}

  @Post()
  create(
    @Body() createZonaDto: CreateZonaEntregaLogisticaDto,
    @Request() req: any,
  ) {
    return this.zonaService.create(req.user.empresaId, createZonaDto);
  }

  @Get()
  findAll(@Request() req: any, @Query('activa') activa?: string) {
    const isActiva =
      activa === 'true' ? true : activa === 'false' ? false : undefined;
    return this.zonaService.findAll(req.user.empresaId, { activa: isActiva });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.zonaService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateZonaDto: UpdateZonaEntregaLogisticaDto,
    @Request() req: any,
  ) {
    return this.zonaService.update(id, req.user.empresaId, updateZonaDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.zonaService.remove(id, req.user.empresaId);
  }
}
