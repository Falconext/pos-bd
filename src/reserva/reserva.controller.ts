import {
  BadRequestException,
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

  private getTenantContext(user: any) {
    const empresaId = Number(user?.empresaId);
    const sedeId = Number(user?.sedeId);

    if (!Number.isFinite(empresaId) || empresaId <= 0) {
      throw new BadRequestException(
        'Contexto inválido: empresa no identificada en la sesión.',
      );
    }

    if (!Number.isFinite(sedeId) || sedeId <= 0) {
      throw new BadRequestException(
        'Debes seleccionar una sede activa antes de gestionar reservas.',
      );
    }

    return { empresaId, sedeId };
  }

  @Get()
  async listar(
    @User() user: any,
    @Query('productoId') productoId?: string,
    @Query('estado') estado?: EstadoReserva,
  ) {
    const ctx = this.getTenantContext(user);
    return this.reservaService.listar({
      empresaId: ctx.empresaId,
      sedeId: ctx.sedeId,
      ...(productoId ? { productoId: Number(productoId) } : {}),
      ...(estado ? { estado } : {}),
    });
  }

  @Get(':id')
  async obtenerPorId(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    const ctx = this.getTenantContext(user);
    return this.reservaService.obtenerPorId(id, ctx.empresaId, ctx.sedeId);
  }

  @Post()
  async crear(@Body() dto: CreateReservaDto, @User() user: any) {
    const ctx = this.getTenantContext(user);
    return this.reservaService.crear(dto, ctx.empresaId, ctx.sedeId);
  }

  @Patch(':id')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReservaDto,
    @User() user: any,
  ) {
    const ctx = this.getTenantContext(user);
    return this.reservaService.actualizar(id, dto, ctx.empresaId, ctx.sedeId);
  }

  @Delete(':id')
  async eliminar(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    const ctx = this.getTenantContext(user);
    return this.reservaService.eliminar(id, ctx.empresaId, ctx.sedeId);
  }
}
