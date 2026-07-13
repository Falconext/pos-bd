import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { DespachoLogisticaService } from './despacho.service';
import {
  CreateDespachoLogisticaDto,
  UpdateEstadoDespachoDto,
} from './dto/create-despacho.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequiresModule } from '../../common/decorators/module.decorator';

@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('logistica')
@Controller('logistica/despachos')
export class DespachoLogisticaController {
  constructor(private readonly despachoService: DespachoLogisticaService) {}

  @Post()
  create(
    @Body() createDespachoDto: CreateDespachoLogisticaDto,
    @Request() req: any,
  ) {
    return this.despachoService.create(req.user.empresaId, createDespachoDto);
  }

  @Get()
  findAll(@Request() req: any, @Query('estado') estado?: string) {
    return this.despachoService.findAll(req.user.empresaId, { estado });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.despachoService.findOne(id, req.user.empresaId);
  }

  @Patch(':id/estado')
  updateEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateEstadoDto: UpdateEstadoDespachoDto,
    @Request() req: any,
  ) {
    return this.despachoService.updateEstado(
      id,
      req.user.empresaId,
      req.user.sub,
      updateEstadoDto,
    );
  }
}
