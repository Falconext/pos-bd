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
import { DispositivosService } from './dispositivos.service';
import { CreateDispositivoDto } from './dto/create-dispositivo.dto';
import { UpdateDispositivoDto } from './dto/update-dispositivo.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/dispositivos')
export class DispositivosController {
  constructor(private readonly dispositivosService: DispositivosService) {}

  @Post()
  create(@Body() dto: CreateDispositivoDto, @Request() req: any) {
    return this.dispositivosService.create(req.user.empresaId, dto);
  }

  @Get()
  findAll(@Request() req: any, @Query('search') search?: string) {
    return this.dispositivosService.findAll(req.user.empresaId, { search });
  }

  @Get('resumen')
  resumen(@Request() req: any) {
    return this.dispositivosService.resumen(req.user.empresaId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.dispositivosService.findOne(id, req.user.empresaId);
  }

  @Get(':id/posiciones')
  posiciones(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
    @Query('limit') limit?: string,
  ) {
    return this.dispositivosService.posiciones(
      id,
      req.user.empresaId,
      limit ? Number(limit) : undefined,
    );
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDispositivoDto,
    @Request() req: any,
  ) {
    return this.dispositivosService.update(id, req.user.empresaId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.dispositivosService.remove(id, req.user.empresaId);
  }
}
