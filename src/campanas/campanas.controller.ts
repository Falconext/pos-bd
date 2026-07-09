import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { CampanasService } from './campanas.service';
import { CreateCampanaDto } from './dto/create-campana.dto';
import { UpdateCampanaDto } from './dto/update-campana.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('campanas')
@UseGuards(JwtAuthGuard)
export class CampanasController {
  constructor(private readonly campanasService: CampanasService) {}

  @Get()
  listar(
    @Req() req: any,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
  ) {
    return this.campanasService.listar(req.user.empresaId, mes, anio);
  }

  @Post()
  crear(@Req() req: any, @Body() dto: CreateCampanaDto) {
    return this.campanasService.crear(req.user.empresaId, dto);
  }

  @Patch(':id')
  actualizar(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCampanaDto,
  ) {
    return this.campanasService.actualizar(req.user.empresaId, id, dto);
  }

  @Delete(':id')
  eliminar(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.campanasService.eliminar(req.user.empresaId, id);
  }
}
