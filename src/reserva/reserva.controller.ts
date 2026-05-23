import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User } from '../common/decorators/user.decorator';
import { ReservaService } from './reserva.service';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { UpdateReservaDto } from './dto/update-reserva.dto';
import { EstadoReserva } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('reservas')
export class ReservaController {
  constructor(private readonly reservaService: ReservaService) {}

  @Get()
  async listar(
    @User() user: any,
    @Query('productoId') productoId?: string,
    @Query('estado') estado?: EstadoReserva,
  ) {
    return this.reservaService.listar({
      empresaId: user.empresaId,
      sedeId: user.sedeId,
      ...(productoId ? { productoId: Number(productoId) } : {}),
      ...(estado ? { estado } : {}),
    });
  }

  @Get(':id')
  async obtenerPorId(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    return this.reservaService.obtenerPorId(id, user.empresaId, user.sedeId);
  }

  @Post()
  async crear(@Body() dto: CreateReservaDto, @User() user: any) {
    return this.reservaService.crear(dto, user.empresaId, user.sedeId);
  }

  @Patch(':id')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReservaDto,
    @User() user: any,
  ) {
    return this.reservaService.actualizar(id, dto, user.empresaId, user.sedeId);
  }

  @Delete(':id')
  async eliminar(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    return this.reservaService.eliminar(id, user.empresaId, user.sedeId);
  }
}
