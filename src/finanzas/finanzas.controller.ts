import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@Controller('finanzas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanzasController {
  constructor(private readonly finanzasService: FinanzasService) {}

  @Get('ecommerce')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async getResumenEcommerce(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const empresaId = user.empresaId;
    const isAdmin =
      user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA';
    const sedeId = isAdmin
      ? sedeIdQuery
        ? Number(sedeIdQuery)
        : null
      : (user.sedeId ?? null);

    return this.finanzasService.getResumenEcommerce(
      empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
  }

  @Get('resumen')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async getResumen(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeIdQuery?: string,
    @Query('usuarioId') usuarioIdQuery?: string,
  ) {
    const empresaId = user.empresaId;
    const isAdmin =
      user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA';
    const sedeId = isAdmin
      ? sedeIdQuery
        ? Number(sedeIdQuery)
        : null
      : (user.sedeId ?? null);
    // El filtro por vendedor solo aplica para administradores de empresa
    const usuarioId = isAdmin
      ? usuarioIdQuery
        ? Number(usuarioIdQuery)
        : null
      : null;
    return this.finanzasService.getResumenFinanciero(
      empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
      usuarioId ?? undefined,
    );
  }

  // ── Ingresos Manuales ─────────────────────────────────────────────────────

  @Get('ingresos-manuales')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  listarIngresos(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.finanzasService.listarIngresos(
      user.empresaId,
      fechaInicio,
      fechaFin,
      tipo,
    );
  }

  @Post('ingresos-manuales')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  crearIngreso(
    @User() user: any,
    @Body()
    body: {
      concepto: string;
      tipo: string;
      monto: number;
      fecha: string;
      descripcion?: string;
    },
  ) {
    return this.finanzasService.crearIngreso(user.empresaId, body);
  }

  @Patch('ingresos-manuales/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  actualizarIngreso(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.finanzasService.actualizarIngreso(user.empresaId, id, body);
  }

  @Delete('ingresos-manuales/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  eliminarIngreso(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.finanzasService.eliminarIngreso(user.empresaId, id);
  }

  // ── Egresos ───────────────────────────────────────────────────────────────

  @Get('egresos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  listarEgresos(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('categoria') categoria?: string,
  ) {
    return this.finanzasService.listarEgresos(
      user.empresaId,
      fechaInicio,
      fechaFin,
      categoria,
    );
  }

  @Post('egresos')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  crearEgreso(
    @User() user: any,
    @Body()
    body: {
      categoria: string;
      etiqueta?: string;
      monto: number;
      fecha: string;
      descripcion?: string;
    },
  ) {
    return this.finanzasService.crearEgreso(user.empresaId, body);
  }

  @Patch('egresos/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  actualizarEgreso(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.finanzasService.actualizarEgreso(user.empresaId, id, body);
  }

  @Delete('egresos/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  eliminarEgreso(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.finanzasService.eliminarEgreso(user.empresaId, id);
  }
}
