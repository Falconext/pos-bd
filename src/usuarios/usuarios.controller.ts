import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiresPermission } from '../common/decorators/permission.decorator';
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

  /**
   * Un ADMIN_EMPRESA/ADMIN_SISTEMA puede otorgar cualquier permiso. Un
   * USUARIO_EMPRESA con permiso 'usuarios' gestiona usuarios, pero NO puede
   * crear/editar uno con permisos totales ('*') — evita escalada de privilegios.
   */
  private bloquearEscaladaPermisos(user: any, permisos?: string[]) {
    const esAdmin =
      user?.rol === 'ADMIN_EMPRESA' || user?.rol === 'ADMIN_SISTEMA';
    if (!esAdmin && Array.isArray(permisos) && permisos.includes('*')) {
      throw new ForbiddenException(
        'No puedes asignar permisos totales (*) a un usuario.',
      );
    }
  }

  @UseGuards(PermissionsGuard)
  @RequiresPermission('usuarios')
  @Post()
  async crear(
    @Body() dto: CreateUserDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Un usuario delegado (con permiso 'usuarios' pero no admin) no puede crear
    // un usuario con permisos totales ('*'), para evitar escalada de privilegios.
    this.bloquearEscaladaPermisos(user, dto.permisos);
    const empresaId = user.empresaId;
    const nuevo = await this.usersService.create(dto, empresaId);
    res.locals.message = 'Usuario creado exitosamente';
    return nuevo;
  }

  @UseGuards(PermissionsGuard)
  @RequiresPermission('usuarios')
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

  @UseGuards(PermissionsGuard)
  @RequiresPermission('usuarios')
  @Patch(':id/estado')
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStateDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.changeState(
      id,
      dto.estado,
      user.empresaId,
    );
    res.locals.message = `Usuario ${dto.estado === 'ACTIVO' ? 'activado' : 'desactivado'} correctamente`;
    return result;
  }

  @UseGuards(PermissionsGuard)
  @RequiresPermission('usuarios')
  @Put(':id')
  async editar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Omit<UpdateUserDto, 'id'>,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.bloquearEscaladaPermisos(user, (body as any)?.permisos);
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
    @User() user?: any,
  ) {
    return this.usersService.listSistema(
      { search, page: Number(page) || 1, limit: Number(limit) || 50 },
      {
        sistemaNegocio: user?.sistemaNegocio ?? null,
        sistemaProducto: user?.sistemaProducto ?? null,
      },
    );
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Post('sistema')
  async crearSistema(
    @Body() dto: CreateUserDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const nuevo = await this.usersService.createSistema(dto, {
      sistemaNegocio: user?.sistemaNegocio ?? null,
      sistemaProducto: user?.sistemaProducto ?? null,
    });
    res.locals.message = 'Administrador creado exitosamente';
    return nuevo;
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Put('sistema/:id')
  async editarSistema(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Omit<UpdateUserDto, 'id'>,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const usuario = await this.usersService.updateSistema(id, body, {
      sistemaNegocio: user?.sistemaNegocio ?? null,
      sistemaProducto: user?.sistemaProducto ?? null,
    });
    res.locals.message = 'Administrador actualizado correctamente';
    return usuario;
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Patch('sistema/:id/estado')
  async cambiarEstadoSistema(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStateDto,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.changeStateSistema(id, dto.estado, {
      sistemaNegocio: user?.sistemaNegocio ?? null,
      sistemaProducto: user?.sistemaProducto ?? null,
    });
    res.locals.message = `Administrador ${dto.estado === 'ACTIVO' ? 'activado' : 'desactivado'} correctamente`;
    return result;
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_SISTEMA')
  @Delete('sistema/:id')
  async eliminarSistema(
    @Param('id', ParseIntPipe) id: number,
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.deleteSistema(id, {
      sistemaNegocio: user?.sistemaNegocio ?? null,
      sistemaProducto: user?.sistemaProducto ?? null,
    });
    res.locals.message = 'Administrador eliminado correctamente';
    return result;
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('ranking-vendedores')
  async rankingVendedores(
    @User() user: any,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Query('sedeId') sedeId?: string,
  ) {
    if (
      !fechaInicio ||
      !fechaFin ||
      Number.isNaN(Date.parse(fechaInicio)) ||
      Number.isNaN(Date.parse(fechaFin))
    ) {
      throw new BadRequestException(
        'fechaInicio y fechaFin son requeridas (formato YYYY-MM-DD)',
      );
    }
    return this.usersService.getRankingVendedores({
      empresaId: user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId: sedeId ? Number(sedeId) : undefined,
    });
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN_EMPRESA')
  @Get('ranking-vendedores/:id')
  async detalleVendedor(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
  ) {
    if (
      !fechaInicio ||
      !fechaFin ||
      Number.isNaN(Date.parse(fechaInicio)) ||
      Number.isNaN(Date.parse(fechaFin))
    ) {
      throw new BadRequestException(
        'fechaInicio y fechaFin son requeridas (formato YYYY-MM-DD)',
      );
    }
    return this.usersService.getDetalleVendedor({
      empresaId: user.empresaId,
      usuarioId: id,
      fechaInicio,
      fechaFin,
    });
  }
}
