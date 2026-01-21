import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Request,
  UseGuards,
  ParseIntPipe,
  ValidationPipe,
  BadRequestException
} from '@nestjs/common';
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

    return this.kardexService.obtenerKardexGeneral(empresaId, filtros);
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

    return this.kardexService.obtenerKardexProducto(productoId, empresaId, filtros);
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

    return this.kardexService.realizarAjusteInventario(ajusteDto, empresaId, usuarioId);
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

    return this.kardexService.realizarAjusteMasivo(ajusteMasivoDto, empresaId, usuarioId);
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

    return this.kardexService.obtenerInventarioValorizado(empresaId, filtros);
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

    const stockActual = await this.kardexService.calcularStockActual(productoId, empresaId);
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

    return this.kardexService.validarConsistenciaStock(empresaId);
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
    const inventario = await this.kardexService.obtenerInventarioValorizado(empresaId);

    // Obtener movimientos recientes
    const movimientosRecientes = await this.kardexService.obtenerKardexGeneral(empresaId, {
      page: 1,
      limit: 10,
    });

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
    });

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
    });
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
    });

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
          resumen.ingresos.cantidad += mov.cantidad;
          resumen.ingresos.movimientos++;
          resumen.ingresos.valorTotal += Number(valor);
          break;
        case 'SALIDA':
          resumen.salidas.cantidad += mov.cantidad;
          resumen.salidas.movimientos++;
          resumen.salidas.valorTotal += Number(valor);
          break;
        case 'AJUSTE':
          resumen.ajustes.cantidad += mov.cantidad;
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

    return this.kardexService.obtenerReporteRotacion(empresaId, fechaInicio_date, fechaFin_date);
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

    return this.kardexService.obtenerAnalisisABC(empresaId, fechaInicio_date, fechaFin_date);
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
    return this.kardexService.obtenerProductosObsoletos(empresaId, dias);
  }

  /**
   * Obtiene dashboard completo de inventario
   */
  @Get('dashboard')
  async obtenerDashboardInventario(@Request() req) {
    const empresaId = req.user.empresaId;
    if (!empresaId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }

    // Obtener datos en paralelo para mejor rendimiento
    const [inventarioValorizado, estadisticas, stockCritico, productosObsoletos] = await Promise.all([
      this.kardexService.obtenerInventarioValorizado(empresaId),
      this.obtenerEstadisticasInventario(req),
      this.kardexService.obtenerInventarioValorizado(empresaId, { soloStockCritico: true }),
      this.kardexService.obtenerProductosObsoletos(empresaId, 60), // 60 días
    ]);

    return {
      resumenGeneral: inventarioValorizado.resumen,
      estadisticas: estadisticas.resumenInventario,
      movimientosRecientes: estadisticas.movimientosRecientes,
      alertas: {
        stockCritico: stockCritico.productos.length,
        productosObsoletos: productosObsoletos.productos.length,
        valorInmovilizado: productosObsoletos.resumen.valorTotalInmovilizado,
      },
      topProductos: {
        stockCritico: stockCritico.productos.slice(0, 5),
        obsoletos: productosObsoletos.productos.slice(0, 5),
      },
      fechaActualizacion: new Date(),
    };
  }
}
