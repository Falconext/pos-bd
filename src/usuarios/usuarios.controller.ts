import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './usuarios.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { ChangeStateDto } from './dto/change-state.dto';
import { EditProfileDto } from './dto/edit-profile.dto';
import type { Response } from 'express';
import { User } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('usuario')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async crear(
    @Body() dto: CreateUserDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresaId = user.empresaId;
    const nuevo = await this.usersService.create(dto, empresaId);
    res.locals.message = 'Usuario creado exitosamente';
    return nuevo;
  }

  @Get()
  async listar(
    @User() user: any,
    @Query() query: ListUsersDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresaId = user.empresaId;
    const resultado = await this.usersService.list({
      empresaId,
      search: query.search,
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
    });
    res.locals.message = 'Usuarios listados correctamente';
    return resultado;
  }

  @Patch(':id/estado')
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStateDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.changeState(id, dto.estado);
    res.locals.message = `Usuario ${dto.estado === 'ACTIVO' ? 'activado' : 'desactivado'} correctamente`;
    return result;
  }

  @Put(':id')
  async editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Omit<UpdateUserDto, 'id'>,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresaId = user.empresaId;
    const dto: UpdateUserDto = { id, ...body } as UpdateUserDto;
    const usuario = await this.usersService.update(dto, empresaId);
    res.locals.message = 'Usuario editado correctamente';
    return usuario;
  }

  @Get('me')
  async verMiPerfil(
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const usuario = await this.usersService.me(user.id ?? user.sub);
    res.locals.message = 'Perfil obtenido correctamente';
    return usuario;
  }

  @Patch('me')
  async editarMiPerfil(
    @User() user: any,
    @Body() dto: EditProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const usuario = await this.usersService.editProfile(
      user.id ?? user.sub,
      dto,
    );
    res.locals.message = 'Perfil actualizado correctamente';
    return usuario;
  }

  @Patch('password')
  async cambiarPassword(
    @User() user: any,
    @Body() body: { actual: string; nueva: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.changePassword(
      user.id ?? user.sub,
      body.actual,
      body.nueva,
    );
    res.locals.message = result.message;
    return { result };
  }

  // ─── ADMIN_SISTEMA: Gestión de usuarios del sistema ──────────────────────────

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Get('sistema')
  async listarSistema(
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.usersService.listSistema({ search, page: Number(page) || 1, limit: Number(limit) || 50 });
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Post('sistema')
  async crearSistema(@Body() dto: CreateUserDto, @Res({ passthrough: true }) res: Response) {
    const nuevo = await this.usersService.createSistema(dto);
    res.locals.message = 'Administrador creado exitosamente';
    return nuevo;
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Put('sistema/:id')
  async editarSistema(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Omit<UpdateUserDto, 'id'>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const usuario = await this.usersService.updateSistema(id, body);
    res.locals.message = 'Administrador actualizado correctamente';
    return usuario;
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Patch('sistema/:id/estado')
  async cambiarEstadoSistema(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStateDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.changeState(id, dto.estado);
    res.locals.message = `Administrador ${dto.estado === 'ACTIVO' ? 'activado' : 'desactivado'} correctamente`;
    return result;
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Delete('sistema/:id')
  async eliminarSistema(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.deleteSistema(id);
    res.locals.message = 'Administrador eliminado correctamente';
    return result;
  }
}
