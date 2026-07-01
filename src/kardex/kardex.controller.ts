import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Request,
  Res,
  UseGuards,
  ParseIntPipe,
  ValidationPipe,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequiresModule } from '../common/decorators/module.decorator';
import { KardexService } from './kardex.service';
import {
  FiltrosKardexDto,
  FiltrosReporteDto
} from './dto/filtros-kardex.dto';
import {
  AjusteInventarioDto,
  AjusteMasivoDto
} from './dto/ajuste-inventario.dto';
import { TrasladoKardexDto } from './dto/traslado-kardex.dto';

@Controller('kardex')
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule('kardex')
export class KardexController {
  constructor(private readonly kardexService: KardexService) { }

  /**
   * Obtiene el kardex general de la empresa con filtros
   */
  @Get()
  async obtenerKardexGeneral(
    @Query(ValidationPipe) filtros: FiltrosKardexDto,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    // Admins see all sedes by default so traslados show both SALIDA and INGRESO.
    // Regular users are always scoped to their sede.
    const isAdmin = ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'].includes(req.user.rol);
    const sedeId = isAdmin ? undefined : req.user.sedeId;

    return this.kardexService.obtenerKardexGeneral(empresaId, filtros, sedeId);
  }

  /**
   * Obtiene el kardex específico de un producto
   */
  @Get('producto/:id')
  async obtenerKardexProducto(
    @Param('id', ParseIntPipe) productoId: number,
    @Query(ValidationPipe) filtros: FiltrosKardexDto,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    return this.kardexService.obtenerKardexProducto(productoId, empresaId, filtros, req.user.sedeId);
  }

  /**
   * Realiza un ajuste de inventario individual
   */
  @Post('ajuste')
  async realizarAjusteInventario(
    @Body(ValidationPipe) ajusteDto: AjusteInventarioDto,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.id;

    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    return this.kardexService.realizarAjusteInventario(ajusteDto, empresaId, usuarioId, req.user.sedeId);
  }

  /**
   * Realiza ajuste masivo de inventario
   */
  @Post('ajuste-masivo')
  async realizarAjusteMasivo(
    @Body(ValidationPipe) ajusteMasivoDto: AjusteMasivoDto,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.id;

    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    return this.kardexService.realizarAjusteMasivo(ajusteMasivoDto, empresaId, usuarioId, req.user.sedeId);
  }

  /**
   * Realiza el traslado de productos entre sedes
   */
  @Post('traslado')
  async realizarTraslado(
    @Body(ValidationPipe) trasladoDto: TrasladoKardexDto,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.id;

    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    return this.kardexService.realizarTraslado(trasladoDto, empresaId, usuarioId);
  }

  /**
   * Obtiene el inventario valorizado
   */
  @Get('inventario-valorizado')
  async obtenerInventarioValorizado(
    @Query(ValidationPipe) filtros: FiltrosReporteDto,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    return this.kardexService.obtenerInventarioValorizado(empresaId, filtros, req.user.sedeId);
  }

  /**
   * Calcula el stock actual de un producto (para validación)
   */
  @Get('stock-actual/:id')
  async calcularStockActual(
    @Param('id', ParseIntPipe) productoId: number,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    const stockActual = await this.kardexService.calcularStockActual(productoId, empresaId, req.user.sedeId);
    return { productoId, stockActual };
  }

  /**
   * Valida la consistencia del stock de toda la empresa
   */
  @Get('validacion-stock')
  async validarConsistenciaStock(@Request() req) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    return this.kardexService.validarConsistenciaStock(empresaId, req.user.sedeId);
  }

  /**
   * Obtiene estadísticas generales de inventario
   */
  @Get('estadisticas')
  async obtenerEstadisticasInventario(@Request() req) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    // Obtener inventario valorizado para las estadísticas
    const inventario = await this.kardexService.obtenerInventarioValorizado(empresaId, undefined, req.user.sedeId);

    // Obtener movimientos recientes
    const movimientosRecientes = await this.kardexService.obtenerKardexGeneral(empresaId, {
      page: 1,
      limit: 10,
    }, req.user.sedeId);

    return {
      resumenInventario: inventario.resumen,
      movimientosRecientes: movimientosRecientes.movimientos,
      fechaActualizacion: new Date(),
    };
  }

  /**
   * Exportar kardex a Excel/CSV (endpoint base - la lógica de exportación se implementaría según necesidades)
   */
  @Get('exportar/:tipo')
  async exportarKardex(
    @Param('tipo') tipo: 'excel' | 'csv',
    @Query(ValidationPipe) filtros: FiltrosKardexDto,
    @Request() req,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    if (!['excel', 'csv'].includes(tipo)) {
      throw new BadRequestException('Tipo de exportación no válido. Use "excel" o "csv"');
    }

    // Obtener todos los movimientos (sin paginación para exportación)
    const kardexCompleto = await this.kardexService.obtenerKardexGeneral(empresaId, {
      ...filtros,
      page: 1,
      limit: 10000, // Límite alto para exportación
    }, req.user.sedeId);

    return {
      tipo,
      totalRegistros: kardexCompleto.paginacion.total,
      movimientos: kardexCompleto.movimientos,
      fechaExportacion: new Date(),
      mensaje: `Datos listos para exportación en formato ${tipo.toUpperCase()}`,
    };
  }

  /**
   * Obtener productos con stock crítico
   */
  @Get('stock-critico')
  async obtenerStockCritico(@Request() req) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    return this.kardexService.obtenerInventarioValorizado(empresaId, {
      soloStockCritico: true,
    }, req.user.sedeId);
  }

  @Get('series-garantias')
  async obtenerSeriesGarantias(
    @Request() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('estado') estado?: string,
    @Query('garantia') garantia?: string,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    const isAdmin = ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'].includes(req.user.rol);
    return this.kardexService.obtenerSeriesGarantias(empresaId, {
      page,
      limit,
      search,
      estado,
      garantia,
      sedeId: isAdmin ? undefined : req.user.sedeId,
    });
  }

  @Post('series-garantias')
  async crearSerie(@Request() req, @Body() body: any) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.crearSerie(empresaId, req.user.sedeId, body);
  }

  @Patch('series-garantias/:id')
  async actualizarSerie(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.actualizarSerie(empresaId, id, body);
  }

  @Delete('series-garantias/:id')
  async eliminarSerie(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.eliminarSerie(empresaId, id);
  }

  @Get('series-garantias/producto/:productoId')
  async seriesPorProducto(
    @Request() req,
    @Param('productoId', ParseIntPipe) productoId: number,
    @Query('estado') estado?: string,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.obtenerSeriesPorProducto(empresaId, productoId, estado);
  }

  @Get('series-garantias/:id/constancia')
  async constanciaGarantia(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');

    const { buffer, filename } = await this.kardexService.generarConstanciaGarantia(empresaId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post('series-garantias/:id/reclamos')
  async crearReclamo(@Request() req, @Param('id', ParseIntPipe) serieId: number, @Body() body: any) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.crearReclamo(empresaId, serieId, body);
  }

  @Get('series-garantias/:id/reclamos')
  async obtenerReclamos(@Request() req, @Param('id', ParseIntPipe) serieId: number) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.obtenerReclamos(empresaId, serieId);
  }

  @Patch('reclamos-garantia/:reclamoId')
  async actualizarReclamo(@Request() req, @Param('reclamoId', ParseIntPipe) reclamoId: number, @Body() body: any) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.actualizarReclamo(empresaId, reclamoId, body);
  }

  @Delete('reclamos-garantia/:reclamoId')
  async eliminarReclamo(@Request() req, @Param('reclamoId', ParseIntPipe) reclamoId: number) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    return this.kardexService.eliminarReclamo(empresaId, reclamoId);
  }

  /**
   * Obtener resumen de movimientos por período
   */
  @Get('resumen-periodo')
  async obtenerResumenPorPeriodo(
    @Request() req,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    // Si no se proporcionan fechas, usar el último mes
    const fechaFin_date = fechaFin ? new Date(fechaFin) : new Date();
    const fechaInicio_date = fechaInicio ? new Date(fechaInicio) :
      new Date(fechaFin_date.getFullYear(), fechaFin_date.getMonth() - 1, fechaFin_date.getDate());

    const movimientos = await this.kardexService.obtenerKardexGeneral(empresaId, {
      fechaInicio: fechaInicio_date.toISOString(),
      fechaFin: fechaFin_date.toISOString(),
      page: 1,
      limit: 10000,
    }, req.user.sedeId);

    // Calcular resumen por tipo de movimiento
    const resumen = {
      periodo: {
        inicio: fechaInicio_date,
        fin: fechaFin_date,
      },
      totalMovimientos: movimientos.movimientos.length,
      ingresos: {
        cantidad: 0,
        movimientos: 0,
        valorTotal: 0,
      },
      salidas: {
        cantidad: 0,
        movimientos: 0,
        valorTotal: 0,
      },
      ajustes: {
        cantidad: 0,
        movimientos: 0,
        valorTotal: 0,
      },
    };

    movimientos.movimientos.forEach(mov => {
      const valor = (mov.valorTotal || 0);

      switch (mov.tipoMovimiento) {
        case 'INGRESO':
          resumen.ingresos.cantidad += Number(mov.cantidad);
          resumen.ingresos.movimientos++;
          resumen.ingresos.valorTotal += Number(valor);
          break;
        case 'SALIDA':
          resumen.salidas.cantidad += Number(mov.cantidad);
          resumen.salidas.movimientos++;
          resumen.salidas.valorTotal += Number(valor);
          break;
        case 'AJUSTE':
          resumen.ajustes.cantidad += Number(mov.cantidad);
          resumen.ajustes.movimientos++;
          resumen.ajustes.valorTotal += Number(valor);
          break;
      }
    });

    return resumen;
  }

  /**
   * Obtiene reporte de rotación de inventario
   */
  @Get('reportes/rotacion')
  async obtenerReporteRotacion(
    @Request() req,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    const fechaInicio_date = fechaInicio ? new Date(fechaInicio) : undefined;
    const fechaFin_date = fechaFin ? new Date(fechaFin) : undefined;

    return this.kardexService.obtenerReporteRotacion(empresaId, fechaInicio_date, fechaFin_date, req.user.sedeId);
  }

  /**
   * Obtiene análisis ABC de productos
   */
  @Get('reportes/abc')
  async obtenerAnalisisABC(
    @Request() req,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    const fechaInicio_date = fechaInicio ? new Date(fechaInicio) : undefined;
    const fechaFin_date = fechaFin ? new Date(fechaFin) : undefined;

    return this.kardexService.obtenerAnalisisABC(empresaId, fechaInicio_date, fechaFin_date, req.user.sedeId);
  }

  /**
   * Obtiene productos obsoletos o con baja rotación
   */
  @Get('reportes/obsoletos')
  async obtenerProductosObsoletos(
    @Request() req,
    @Query('diasSinMovimiento') diasSinMovimiento?: string,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    const dias = diasSinMovimiento ? parseInt(diasSinMovimiento, 10) : 90;
    return this.kardexService.obtenerProductosObsoletos(empresaId, dias, req.user.sedeId);
  }

  /**
   * Obtiene dashboard completo de inventario
   */
  @Get('libro-control-psicotropicos')
  async obtenerLibroControlPsicotropicos(
    @Request() req,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Query('productoId') productoId?: string,
  ) {
    const empresaId = req.user.empresaId;
    if (!empresaId) throw new BadRequestException('Usuario sin empresa asignada');
    const inicio = fechaInicio ? new Date(`${fechaInicio}T00:00:00-05:00`) : new Date(new Date().getFullYear(), 0, 1);
    const fin = fechaFin ? new Date(`${fechaFin}T23:59:59-05:00`) : new Date();
    return this.kardexService.obtenerLibroControlPsicotropicos({
      empresaId,
      fechaInicio: inicio,
      fechaFin: fin,
      productoId: productoId ? Number(productoId) : undefined,
    });
  }

  @Get('dashboard')
  async obtenerDashboardInventario(@Request() req) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    const [inventarioValorizado, movimientosRecientes, stockCritico, productosObsoletos, farmacia] = await Promise.all([
      this.kardexService.obtenerInventarioValorizado(empresaId, undefined, req.user.sedeId),
      this.kardexService.obtenerKardexGeneral(empresaId, { page: 1, limit: 10 }, req.user.sedeId),
      this.kardexService.obtenerInventarioValorizado(empresaId, { soloStockCritico: true }, req.user.sedeId),
      this.kardexService.obtenerProductosObsoletos(empresaId, 60, req.user.sedeId),
      this.kardexService.obtenerDashboardFarmacia(empresaId),
    ]);

    return {
      resumenGeneral: inventarioValorizado.resumen,
      movimientosRecientes: movimientosRecientes.movimientos,
      alertas: {
        stockCritico: stockCritico.productos.length,
        productosObsoletos: productosObsoletos.productos.length,
        valorInmovilizado: productosObsoletos.resumen.valorTotalInmovilizado,
      },
      topProductos: {
        stockCritico: stockCritico.productos.slice(0, 5),
        obsoletos: productosObsoletos.productos.slice(0, 5),
      },
      farmacia,
      fechaActualizacion: new Date(),
    };
  }
}
