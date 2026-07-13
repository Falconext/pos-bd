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
import { DocumentosService } from './documentos.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { UpdateDocumentoDto } from './dto/update-documento.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/documentos')
export class DocumentosController {
  constructor(private readonly documentosService: DocumentosService) {}

  @Post()
  create(@Body() dto: CreateDocumentoDto, @Request() req: any) {
    return this.documentosService.create(req.user.empresaId, dto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('entidad') entidad?: string,
    @Query('vehiculoId') vehiculoId?: string,
    @Query('conductorId') conductorId?: string,
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
    @Query('search') search?: string,
  ) {
    return this.documentosService.findAll(req.user.empresaId, {
      entidad,
      vehiculoId: vehiculoId ? Number(vehiculoId) : undefined,
      conductorId: conductorId ? Number(conductorId) : undefined,
      tipo,
      estado,
      search,
    });
  }

  @Get('alertas')
  alertas(@Request() req: any, @Query('dias') dias?: string) {
    return this.documentosService.alertas(
      req.user.empresaId,
      dias ? Number(dias) : 30,
    );
  }

  @Get('resumen')
  resumen(@Request() req: any, @Query('dias') dias?: string) {
    return this.documentosService.resumen(
      req.user.empresaId,
      dias ? Number(dias) : 30,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.documentosService.findOne(id, req.user.empresaId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDocumentoDto,
    @Request() req: any,
  ) {
    return this.documentosService.update(id, req.user.empresaId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.documentosService.remove(id, req.user.empresaId);
  }
}
