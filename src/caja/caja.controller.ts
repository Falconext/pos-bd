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
  Res,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User } from '../common/decorators/user.decorator';
import { CajaService } from './caja.service';
import { AperturaCajaDto, CierreCajaDto, EstadoCajaDto, RegistrarEgresoDto, EditarEgresoDto } from './dto/caja.dto';
import type { Response } from 'express';
import * as XLSX from 'xlsx';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('caja')
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Post('abrir')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async abrirCaja(@User() user: any, @Body() aperturaCajaDto: AperturaCajaDto) {
    return await this.cajaService.abrirCaja(
      user.id,
      user.empresaId,
      aperturaCajaDto,
      user.sedeId,
    );
  }

  @Post('cerrar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async cerrarCaja(@User() user: any, @Body() cierreCajaDto: CierreCajaDto) {
    return await this.cajaService.cerrarCaja(
      user.id,
      user.empresaId,
      cierreCajaDto,
      user.sedeId,
    );
  }

  @Get('estado')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerEstadoCaja(@User() user: any) {
    return await this.cajaService.obtenerEstadoCaja(user.id, user.empresaId, user.sedeId);
  }

  @Get('historial')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerHistorialCaja(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const isAdmin = ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'].includes(user.rol);
    const sedeId = isAdmin ? (sedeIdQuery ? Number(sedeIdQuery) : null) : user.sedeId;

    return await this.cajaService.obtenerHistorialCaja(
      user.empresaId,
      fechaInicio,
      fechaFin,
      pageNum,
      limitNum,
      sedeId,
    );
  }

  @Get('arqueo')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerArqueoConCaja(
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('sedeId') sedeIdQuery?: string,
  ) {
    const isAdmin = ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'].includes(user.rol);
    const sedeId = isAdmin ? (sedeIdQuery ? Number(sedeIdQuery) : null) : user.sedeId;
    const arqueo = await this.cajaService.obtenerArqueoConCaja(
      user.empresaId,
      fechaInicio,
      fechaFin,
      sedeId,
    );
    res.locals.message = 'Arqueo de caja obtenido correctamente';
    return arqueo;
  }

  @Get('arqueo-exportar')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async exportarArqueoConCaja(
    @User() user: any,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Res() res: Response,
  ) {
    const arqueo = await this.cajaService.obtenerArqueoConCaja(
      user.empresaId,
      fechaInicio,
      fechaFin,
      user.sedeId,
    );

    // Preparar datos para Excel
    const movimientosCajaExcel = arqueo.movimientosCaja.map((mov) => ({
      TIPO: mov.tipoMovimiento,
      TURNO: mov.turno || '-',
      USUARIO: mov.usuario?.nombre || 'Sin usuario',
      FECHA: new Date(mov.fecha).toISOString().split('T')[0],
      HORA: new Date(mov.fecha).toLocaleTimeString('es-PE'),
      'MONTO INICIAL': Number(mov.montoInicial || 0),
      'MONTO FINAL': Number(mov.montoFinal || 0),
      EFECTIVO: Number(mov.montoEfectivo || 0),
      YAPE: Number(mov.montoYape || 0),
      PLIN: Number(mov.montoPlin || 0),
      TRANSFERENCIA: Number(mov.montoTransferencia || 0),
      TARJETA: Number(mov.montoTarjeta || 0),
      'TOTAL VENTAS': Number(mov.totalVentas || 0),
      DIFERENCIA: Number(mov.diferencia || 0),
      OBSERVACIONES: mov.observaciones || '-',
    }));

    // Crear hoja de movimientos de caja
    const worksheetMovimientos = XLSX.utils.json_to_sheet(movimientosCajaExcel);

    // Ajustar anchos de columnas
    worksheetMovimientos['!cols'] = [
      { wch: 12 }, // TIPO
      { wch: 12 }, // TURNO
      { wch: 25 }, // USUARIO
      { wch: 12 }, // FECHA
      { wch: 12 }, // HORA
      { wch: 15 }, // MONTO INICIAL
      { wch: 15 }, // MONTO FINAL
      { wch: 12 }, // EFECTIVO
      { wch: 12 }, // YAPE
      { wch: 12 }, // PLIN
      { wch: 15 }, // TRANSFERENCIA
      { wch: 12 }, // TARJETA
      { wch: 15 }, // TOTAL VENTAS
      { wch: 12 }, // DIFERENCIA
      { wch: 30 }, // OBSERVACIONES
    ];

    // Agregar resumen de arqueo
    XLSX.utils.sheet_add_aoa(worksheetMovimientos, [[''], ['']], { origin: -1 });

    const resumenData = [
      ['RESUMEN ARQUEO DE CAJA', ''],
      ['TOTAL APERTURAS', arqueo.resumenCaja.totalAperturas],
      ['TOTAL CIERRES', arqueo.resumenCaja.totalCierres],
      ['MONTO INICIAL TOTAL', arqueo.resumenCaja.montoInicialTotal],
      ['MONTO FINAL TOTAL', arqueo.resumenCaja.montoFinalTotal],
      ['DIFERENCIAS TOTAL', arqueo.resumenCaja.diferenciasTotal],
      ['TOTAL EFECTIVO', arqueo.ventasDelPeriodo.mediosPago.EFECTIVO],
      ['TOTAL YAPE', arqueo.ventasDelPeriodo.mediosPago.YAPE],
      ['TOTAL PLIN', arqueo.ventasDelPeriodo.mediosPago.PLIN],
      ['TOTAL TRANSFERENCIA', arqueo.ventasDelPeriodo.mediosPago.TRANSFERENCIA],
      ['TOTAL TARJETA', arqueo.ventasDelPeriodo.mediosPago.TARJETA],
      ['TOTAL INGRESOS:', arqueo.ventasDelPeriodo.totalIngresos],
    ];

    XLSX.utils.sheet_add_aoa(
      worksheetMovimientos,
      resumenData.map(([label, value]) =>
        Array(12).fill('').concat([label, value]),
      ),
      { origin: -1 },
    );

    // Crear y devolver el archivo
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheetMovimientos,
      'Arqueo de Caja',
    );
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    // Generar archivo Excel
    const fechaInicioParsed = fechaInicio || new Date().toISOString().split('T')[0];
    const fechaFinParsed = fechaFin || new Date().toISOString().split('T')[0];
    const fileName = `arqueo-caja-${fechaInicioParsed}_a_${fechaFinParsed}.xlsx`;
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    return res.end(buffer, 'binary');
  }

  @Get('reporte-turno')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async obtenerReporteTurno(
    @User() user: any,
    @Query('turno') turno: string,
    @Query('fecha') fecha?: string,
  ) {
    if (!turno) {
      throw new BadRequestException('El parámetro turno es requerido');
    }
    return await this.cajaService.obtenerReporteTurno(
      user.empresaId,
      turno,
      fecha,
      user.sedeId,
    );
  }

  @Get('reporte-usuarios-turno')
  @Roles('ADMIN_EMPRESA')
  async obtenerReporteUsuariosPorTurno(
    @User() user: any,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    return await this.cajaService.obtenerReporteUsuariosPorTurno(
      user.empresaId,
      fechaInicio,
      fechaFin,
      user.sedeId,
    );
  }

  @Post('egreso')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async registrarEgreso(@User() user: any, @Body() dto: RegistrarEgresoDto) {
    return await this.cajaService.registrarEgreso(user.id, user.empresaId, dto, user.sedeId);
  }

  @Patch('egreso/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async editarEgreso(
    @User() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditarEgresoDto,
  ) {
    return await this.cajaService.editarEgreso(user.empresaId, id, dto);
  }

  @Delete('egreso/:id')
  @Roles('ADMIN_EMPRESA', 'USUARIO_EMPRESA')
  async eliminarEgreso(@User() user: any, @Param('id', ParseIntPipe) id: number) {
    return await this.cajaService.eliminarEgreso(user.empresaId, id);
  }
}