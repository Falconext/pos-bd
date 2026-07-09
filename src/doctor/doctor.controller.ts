import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import type { Response } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('doctors')
export class DoctorController {
  constructor(private readonly service: DoctorService) {}

  @Post()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async crear(
    @Body() dto: CreateDoctorDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doctor = await this.service.crear(user.empresaId, dto);
    res.locals.message = 'Doctor registrado correctamente';
    return doctor;
  }

  @Get()
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async listar(@User() user: any, @Query('search') search?: string) {
    return this.service.listar(user.empresaId, search);
  }

  @Get(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtener(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    return this.service.obtener(user.empresaId, id);
  }

  @Get(':id/pacientes')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async pacientes(@Param('id', ParseIntPipe) id: number, @User() user: any) {
    return this.service.pacientes(user.empresaId, id);
  }

  @Put(':id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDoctorDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doctor = await this.service.actualizar(user.empresaId, id, dto);
    res.locals.message = 'Doctor actualizado correctamente';
    return doctor;
  }

  @Delete(':id')
  @Roles('ADMIN_EMPRESA')
  async eliminar(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.eliminar(user.empresaId, id);
    res.locals.message = 'Doctor desactivado correctamente';
    return {};
  }
}
