import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ContratoVehicularService } from './contrato-vehicular.service';
import { CreateContratoVehicularDto } from './dto/create-contrato.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('contratos-vehiculares')
export class ContratoVehicularController {
  constructor(private readonly contratoService: ContratoVehicularService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('estado') estado?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('soloProximosVencer') soloProximosVencer?: string,
  ) {
    return this.contratoService.findAll(req.user.empresaId, {
      estado,
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 30,
      soloProximosVencer: soloProximosVencer === 'true',
    });
  }

  @Get('alertas')
  findAlertas(@Request() req: any) {
    return this.contratoService.findAlertas(req.user.empresaId);
  }

  @Post()
  create(@Body() dto: CreateContratoVehicularDto, @Request() req: any) {
    return this.contratoService.create(req.user.empresaId, dto);
  }

  @Patch(':id/renovar')
  renovar(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.contratoService.renovar(id, req.user.empresaId);
  }

  @Patch(':id/cancelar')
  cancelar(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.contratoService.cancelar(id, req.user.empresaId);
  }
}
