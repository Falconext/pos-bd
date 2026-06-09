import {
  Controller,
  Get,
  Patch,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ComisionesService } from './comisiones.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('comisiones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ComisionesController {
  constructor(private readonly comisionesService: ComisionesService) {}

  /**
   * GET /comisiones/resumen?mes=6&anio=2026
   * Solo dueño/admin puede ver el resumen de todos los vendedores.
   */
  @Get('resumen')
  @Roles('ADMIN_EMPRESA', 'SUPERADMIN')
  async getResumenMensual(
    @Req() req: any,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
  ) {
    const empresaId = req.user.empresaId;
    return this.comisionesService.listarResumenMensual(empresaId, mes, anio);
  }

  /**
   * GET /comisiones/mis-comisiones?mes=6&anio=2026
   * Vendedor ve sus propias comisiones.
   */
  @Get('mis-comisiones')
  async getMisComisiones(
    @Req() req: any,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
  ) {
    const { empresaId, id: vendedorId } = req.user;
    return this.comisionesService.listarComisionesVendedor(
      empresaId,
      vendedorId,
      mes,
      anio,
    );
  }

  /**
   * GET /comisiones/vendedor/:vendedorId?mes=6&anio=2026
   * Admin puede ver comisiones de un vendedor específico.
   */
  @Get('vendedor/:vendedorId')
  @Roles('ADMIN_EMPRESA', 'SUPERADMIN')
  async getComisionesVendedor(
    @Req() req: any,
    @Param('vendedorId', ParseIntPipe) vendedorId: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
  ) {
    const empresaId = req.user.empresaId;
    return this.comisionesService.listarComisionesVendedor(
      empresaId,
      vendedorId,
      mes,
      anio,
    );
  }

  /**
   * PATCH /comisiones/pagar/:vendedorId?mes=6&anio=2026
   * El dueño liquida todas las comisiones pendientes de un vendedor en el mes.
   */
  @Patch('pagar/:vendedorId')
  @Roles('ADMIN_EMPRESA', 'SUPERADMIN')
  async marcarPagadas(
    @Req() req: any,
    @Param('vendedorId', ParseIntPipe) vendedorId: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
  ) {
    const empresaId = req.user.empresaId;
    return this.comisionesService.marcarComisionesPagadas(
      empresaId,
      vendedorId,
      mes,
      anio,
    );
  }

  /**
   * GET /comisiones/exportar?mes=6&anio=2026
   * Exportar lista plana para generar Excel en el frontend.
   */
  @Get('exportar')
  @Roles('ADMIN_EMPRESA', 'SUPERADMIN')
  async exportar(
    @Req() req: any,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
  ) {
    const empresaId = req.user.empresaId;
    return this.comisionesService.exportarComisionesMes(empresaId, mes, anio);
  }
}
