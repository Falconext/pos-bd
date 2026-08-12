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
import { ConciliacionBancariaService } from './conciliacion-bancaria.service';
import { ConciliacionImportarDto } from './dto/conciliacion.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';

@Controller('finanzas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanzasController {
  constructor(
    private readonly finanzasService: FinanzasService,
    private readonly conciliacionService: ConciliacionBancariaService,
  ) {}

  // ── Conciliación bancaria ─────────────────────────────────────────────────

  @Get('conciliacion/plantilla')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  plantillaConciliacion() {
    return this.conciliacionService.plantilla();
  }

  @Post('conciliacion/importar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  importarConciliacion(
    @User() user: any,
    @Body() dto: ConciliacionImportarDto,
  ) {
    return this.conciliacionService.conciliar(
      user.empresaId,
      dto.archivoBase64,
      dto.fechaInicio,
      dto.fechaFin,
    );
  }

  // Exporta a Excel el resultado de una conciliación ya calculada (sin persistir).
  // Se recibe el `resultado` tal cual lo devolvió el endpoint /conciliacion/importar
  // más las observaciones opcionales del usuario. Body tipado como `any` a propósito
  // para no perder el objeto anidado con el ValidationPipe (whitelist).
  @Post('conciliacion/exportar-excel')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  exportarConciliacionExcel(@Body() body: any) {
    return this.conciliacionService.exportarExcel(
      body?.resultado,
      body?.observaciones,
    );
  }

  // Persiste una conciliación para poder consultarla luego (historial).
  // Body tipado como `any` a propósito: lleva el objeto anidado `resultado` que
  // el ValidationPipe (whitelist) descartaría con un DTO estricto.
  @Post('conciliacion/guardar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  guardarConciliacion(@User() user: any, @Body() body: any) {
    return this.conciliacionService.guardar(user.empresaId, {
      resultado: body?.resultado,
      observaciones: body?.observaciones,
      fechaInicio: body?.fechaInicio,
      fechaFin: body?.fechaFin,
      usuarioId: user?.sub ?? user?.id ?? undefined,
    });
  }

  @Get('conciliacion/guardadas')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  listarConciliacionesGuardadas(@User() user: any) {
    return this.conciliacionService.listarGuardadas(user.empresaId);
  }

  @Get('conciliacion/guardadas/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  obtenerConciliacionGuardada(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.conciliacionService.obtenerGuardada(user.empresaId, id);
  }

  @Delete('conciliacion/guardadas/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  eliminarConciliacionGuardada(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.conciliacionService.eliminarGuardada(user.empresaId, id);
  }

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
