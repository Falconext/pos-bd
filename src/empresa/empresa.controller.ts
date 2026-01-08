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
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { EmpresaService } from './empresa.service';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { ListEmpresaDto } from './dto/list-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@Controller('empresa')
export class EmpresaController {
  constructor(private readonly empresaService: EmpresaService) { }

  @Post('crear')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async crear(
    @Body() dto: CreateEmpresaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const nueva = await this.empresaService.crear(dto);
    res.locals.message = 'Empresa creada exitosamente';
    return nueva;
  }

  @Post('registro')
  async registro(
    @Body() dto: CreateEmpresaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const nueva = await this.empresaService.crear(dto);
    res.locals.message = 'Empresa registrada exitosamente';
    return nueva;
  }

  @Get('mia')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerMiEmpresa(
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresa = await this.empresaService.obtenerMiEmpresa(user.empresaId);
    res.locals.message = 'Información de la empresa cargada correctamente';
    return empresa;
  }

  @Put('mia')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async actualizarMiEmpresa(
    @User() user: any,
    @Body() body: Partial<UpdateEmpresaDto>,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Force ID to match user's company
    const dto: UpdateEmpresaDto = { ...body, id: user.empresaId } as UpdateEmpresaDto;
    const result = await this.empresaService.actualizar(dto);
    res.locals.message = 'Información de empresa actualizada correctamente';
    return result;
  }

  @Get('listar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async listar(
    @Query() query: ListEmpresaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresas = await this.empresaService.listar(query);
    res.locals.message = 'Empresas listadas correctamente';
    return empresas;
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Omit<UpdateEmpresaDto, 'id'>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dto: UpdateEmpresaDto = { id, ...body } as UpdateEmpresaDto;
    const result = await this.empresaService.actualizar(dto);
    res.locals.message = 'Empresa actualizada correctamente';
    return result;
  }

  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado: 'ACTIVO' | 'INACTIVO' },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.empresaService.cambiarEstado(id, body.estado);
    res.locals.message = `Empresa ${body.estado === 'ACTIVO' ? 'activada' : 'desactivada'} correctamente`;
    return result;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async eliminar(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.empresaService.eliminar(id);
    res.locals.message = 'Empresa eliminada correctamente';
    return result;
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async obtenerPorId(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const empresa = await this.empresaService.obtenerPorId(id);
    res.locals.message = 'Empresa obtenida correctamente';
    return empresa;
  }

  @Get('consultar-ruc/:ruc')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async consultarRuc(
    @Param('ruc') ruc: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!ruc || ruc.length !== 11) {
      throw new BadRequestException('RUC debe tener 11 dígitos');
    }
    const resultado = await this.empresaService.consultarRuc(ruc);
    res.locals.message = 'Consulta RUC realizada correctamente';
    return resultado;
  }

  @Get('proximas-vencer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN_SISTEMA')
  async empresasProximasVencer(
    @Query('dias') dias: string = '7',
    @Res({ passthrough: true }) res: Response,
  ) {
    const diasAntes = parseInt(dias) || 7;
    const empresas =
      await this.empresaService.obtenerEmpresasProximasVencer(diasAntes);
    res.locals.message = `Empresas que vencen en ${diasAntes} días obtenidas correctamente`;
    return empresas;
  }
}
