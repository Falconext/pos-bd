import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FiltrosKardexDto,
  FiltrosReporteDto,
  TipoMovimiento
} from './dto/filtros-kardex.dto';
import {
  AjusteInventarioDto,
  AjusteMasivoDto,
  TipoAjuste
} from './dto/ajuste-inventario.dto';
import {
  KardexProductoResponse,
  MovimientoKardexResponse,
  InventarioValorizadoResponse,
  ReporteRotacionResponse
} from './dto/response-kardex.dto';

@Injectable()
export class KardexService {
  constructor(private prisma: PrismaService) { }

  /**
   * Registra un movimiento de kardex automáticamente
   */
  async registrarMovimiento(data: {
    productoId: number;
    empresaId: number;
    tipoMovimiento: 'INGRESO' | 'SALIDA' | 'AJUSTE' | 'TRANSFERENCIA';
    concepto: string;
    cantidad: number;
    comprobanteId?: number;
    compraId?: number;
    costoUnitario?: number;
    usuarioId?: number;
    observacion?: string;
    lote?: string;
    fechaVencimiento?: Date;
  }) {
    // Obtener el producto actual
    const producto = await this.prisma.producto.findUnique({
      where: { id: data.productoId },
      select: { stock: true, costoPromedio: true },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    const stockAnterior = producto.stock;
    let stockActual = stockAnterior;

    // Calcular nuevo stock según el tipo de movimiento
    switch (data.tipoMovimiento) {
      case 'INGRESO':
        stockActual += data.cantidad;
        break;
      case 'SALIDA':
        stockActual -= data.cantidad;
        break;
      case 'AJUSTE':
        // Para ajustes, la cantidad puede ser positiva o negativa
        stockActual = data.cantidad;
        break;
      case 'TRANSFERENCIA':
        // Lógica específica para transferencias
        stockActual -= data.cantidad;
        break;
    }

    // Calcular costo unitario si no se proporciona
    let costoUnitario = data.costoUnitario;
    if (!costoUnitario && data.tipoMovimiento === 'INGRESO') {
      costoUnitario = Number(producto.costoPromedio) || 0;
    }

    const valorTotal = costoUnitario ? costoUnitario * data.cantidad : null;

    // Crear el movimiento
    const movimiento = await this.prisma.movimientoKardex.create({
      data: {
        productoId: data.productoId,
        empresaId: data.empresaId,
        tipoMovimiento: data.tipoMovimiento as any,
        concepto: data.concepto,
        cantidad: data.cantidad,
        stockAnterior,
        stockActual,
        costoUnitario: costoUnitario || null,
        valorTotal: valorTotal || null,
        comprobanteId: data.comprobanteId,
        compraId: data.compraId,
        usuarioId: data.usuarioId,
        observacion: data.observacion,
        lote: data.lote,
        fechaVencimiento: data.fechaVencimiento,
      },
      include: {
        producto: {
          include: {
            unidadMedida: true,
          },
        },
        usuario: {
          select: {
            id: true,
            nombre: true,
          },
        },
        comprobante: {
          select: {
            id: true,
            tipoDoc: true,
            serie: true,
            correlativo: true,
          },
        },
        compra: {
          select: {
            id: true,
            serie: true,
            numero: true,
          }
        }
      },
    });

    // Actualizar el stock y costo promedio del producto
    await this.actualizarStockYCosto(data.productoId, stockActual, data.tipoMovimiento, costoUnitario, data.cantidad);

    return movimiento;
  }

  /**
   * Obtiene el kardex completo de un producto
   */
  async obtenerKardexProducto(
    productoId: number,
    empresaId: number,
    filtros?: FiltrosKardexDto,
  ): Promise<KardexProductoResponse> {
    // Verificar que el producto existe y pertenece a la empresa
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      include: {
        unidadMedida: true,
        categoria: true,
      },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Construir filtros para movimientos
    const whereMovimientos: any = {
      productoId,
      empresaId,
    };

    if (filtros?.fechaInicio || filtros?.fechaFin) {
      const toLocalStart = (s: string) =>
        /T/.test(s)
          ? new Date(s)
          : new Date(`${s}T00:00:00.000-05:00`);
      const toLocalEnd = (s: string) =>
        /T/.test(s)
          ? new Date(s)
          : new Date(`${s}T23:59:59.999-05:00`);
      whereMovimientos.fecha = {};
      if (filtros.fechaInicio) {
        whereMovimientos.fecha.gte = toLocalStart(filtros.fechaInicio);
      }
      if (filtros.fechaFin) {
        whereMovimientos.fecha.lte = toLocalEnd(filtros.fechaFin);
      }
    }

    if (filtros?.tipoMovimiento) {
      whereMovimientos.tipoMovimiento = filtros.tipoMovimiento;
    }

    if (filtros?.concepto) {
      whereMovimientos.concepto = {
        contains: filtros.concepto,
        mode: 'insensitive',
      };
    }

    // Paginación
    const page = filtros?.page || 1;
    const limit = filtros?.limit || 50;
    const skip = (page - 1) * limit;

    // Obtener movimientos
    const [movimientos, totalMovimientos] = await Promise.all([
      this.prisma.movimientoKardex.findMany({
        where: whereMovimientos,
        include: {
          usuario: {
            select: { id: true, nombre: true },
          },
          comprobante: {
            select: { id: true, tipoDoc: true, serie: true, correlativo: true },
          },
          producto: {
            include: {
              unidadMedida: true,
            },
          },
        },
        orderBy: { fecha: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.movimientoKardex.count({ where: whereMovimientos }),
    ]);

    // Calcular resumen
    const resumen = await this.calcularResumenKardex(productoId, empresaId);

    return {
      producto: {
        id: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        stock: producto.stock,
        stockMinimo: producto.stockMinimo || 0,
        stockMaximo: producto.stockMaximo || 0,
        costoPromedio: Number(producto.costoPromedio) || 0,
        unidadMedida: {
          codigo: producto.unidadMedida.codigo,
          nombre: producto.unidadMedida.nombre,
        },
        categoria: producto.categoria ? {
          id: producto.categoria.id,
          nombre: producto.categoria.nombre,
        } : undefined,
      },
      movimientos: movimientos.map(mov => ({
        ...mov,
        costoUnitario: mov.costoUnitario ? Number(mov.costoUnitario) : undefined,
        valorTotal: mov.valorTotal ? Number(mov.valorTotal) : undefined,
      })) as MovimientoKardexResponse[],
      resumen,
      paginacion: {
        page,
        limit,
        total: totalMovimientos,
        totalPages: Math.ceil(totalMovimientos / limit),
      },
    };
  }

  /**
   * Obtiene kardex general de la empresa con filtros
   */
  async obtenerKardexGeneral(empresaId: number, filtros?: FiltrosKardexDto) {
    const whereMovimientos: any = { empresaId };

    // Aplicar filtros
    if (filtros?.fechaInicio || filtros?.fechaFin) {
      const toLocalStart = (s: string) =>
        /T/.test(s)
          ? new Date(s)
          : new Date(`${s}T00:00:00.000-05:00`);
      const toLocalEnd = (s: string) =>
        /T/.test(s)
          ? new Date(s)
          : new Date(`${s}T23:59:59.999-05:00`);
      whereMovimientos.fecha = {};
      if (filtros.fechaInicio) whereMovimientos.fecha.gte = toLocalStart(filtros.fechaInicio);
      if (filtros.fechaFin) whereMovimientos.fecha.lte = toLocalEnd(filtros.fechaFin);
    }

    if (filtros?.productoId) whereMovimientos.productoId = filtros.productoId;
    if (filtros?.tipoMovimiento) whereMovimientos.tipoMovimiento = filtros.tipoMovimiento;
    if (filtros?.concepto) {
      whereMovimientos.concepto = { contains: filtros.concepto, mode: 'insensitive' };
    }

    // Si hay filtro por categoría, incluir en la consulta del producto
    if (filtros?.categoriaId) {
      whereMovimientos.producto = {
        categoriaId: filtros.categoriaId,
      };
    }

    const page = filtros?.page || 1;
    const limit = filtros?.limit || 50;
    const skip = (page - 1) * limit;

    const [movimientos, total] = await Promise.all([
      this.prisma.movimientoKardex.findMany({
        where: whereMovimientos,
        include: {
          producto: {
            include: {
              unidadMedida: true,
              categoria: true,
            },
          },
          usuario: { select: { id: true, nombre: true } },
          comprobante: { select: { id: true, tipoDoc: true, serie: true, correlativo: true } },
        },
        orderBy: { fecha: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.movimientoKardex.count({ where: whereMovimientos }),
    ]);

    // Mapear movimientos con campos calculados
    const movimientosMapeados = movimientos.map(mov => {
      // Obtener costo unitario: si no existe en el movimiento, usar costo promedio del producto
      const costoUnitarioMovimiento = mov.costoUnitario ? Number(mov.costoUnitario) : null;
      const costoPromedioProducto = mov.producto && mov.producto.costoPromedio ? Number(mov.producto.costoPromedio) : 0;
      const costoFinal = costoUnitarioMovimiento || costoPromedioProducto;

      // Calcular valor total si no existe
      const valorTotal = mov.valorTotal ? Number(mov.valorTotal) : (costoFinal * mov.cantidad);

      // Calcular ganancia unitaria
      const precioVenta = mov.producto ? Number(mov.producto.precioUnitario || 0) : 0;
      const gananciaUnidad = precioVenta > 0 && costoFinal > 0 ? precioVenta - costoFinal : 0;

      return {
        ...mov,
        costoUnitario: costoFinal,
        valorTotal: valorTotal,
        gananciaUnidad: gananciaUnidad,
        producto: mov.producto ? {
          ...mov.producto,
          precioUnitario: Number(mov.producto.precioUnitario || 0),
          costoPromedio: Number(mov.producto.costoPromedio || 0),
        } : null,
      };
    });

    return {
      movimientos: movimientosMapeados,
      paginacion: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Realiza ajuste de inventario
   */
  async realizarAjusteInventario(
    ajusteDto: AjusteInventarioDto,
    empresaId: number,
    usuarioId?: number,
  ) {
    // Verificar que el producto existe
    const producto = await this.prisma.producto.findFirst({
      where: { id: ajusteDto.productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    let cantidad: number;
    let nuevoStock: number;

    switch (ajusteDto.tipoAjuste) {
      case TipoAjuste.POSITIVO:
        cantidad = ajusteDto.cantidad;
        nuevoStock = producto.stock + cantidad;
        break;
      case TipoAjuste.NEGATIVO:
        cantidad = -ajusteDto.cantidad;
        nuevoStock = Math.max(0, producto.stock - ajusteDto.cantidad);
        break;
      case TipoAjuste.CORRECCION:
        cantidad = ajusteDto.cantidad - producto.stock;
        nuevoStock = ajusteDto.cantidad;
        break;
    }

    // Registrar el movimiento
    const movimiento = await this.registrarMovimiento({
      productoId: ajusteDto.productoId,
      empresaId,
      tipoMovimiento: 'AJUSTE',
      concepto: `Ajuste ${ajusteDto.tipoAjuste.toLowerCase()}: ${ajusteDto.motivo}`,
      cantidad: Math.abs(cantidad),
      costoUnitario: ajusteDto.costoUnitario,
      usuarioId,
      observacion: ajusteDto.observacion,
      lote: ajusteDto.lote,
      fechaVencimiento: ajusteDto.fechaVencimiento ? new Date(ajusteDto.fechaVencimiento) : undefined,
    });

    return movimiento;
  }

  /**
   * Realizar ajuste masivo de inventario
   */
  async realizarAjusteMasivo(
    ajusteMasivoDto: AjusteMasivoDto,
    empresaId: number,
    usuarioId?: number,
  ) {
    const resultados: Array<{
      productoId: number;
      exito: boolean;
      movimiento?: any;
      error?: string;
    }> = [];

    for (const ajuste of ajusteMasivoDto.ajustes) {
      try {
        const resultado = await this.realizarAjusteInventario(
          {
            ...ajuste,
            motivo: `${ajusteMasivoDto.motivoGeneral} - ${ajuste.motivo}`,
            observacion: ajusteMasivoDto.observacionGeneral || ajuste.observacion,
          },
          empresaId,
          usuarioId,
        );
        resultados.push({ productoId: ajuste.productoId, exito: true, movimiento: resultado });
      } catch (error: any) {
        resultados.push({
          productoId: ajuste.productoId,
          exito: false,
          error: error.message
        });
      }
    }

    return {
      ajustesRealizados: resultados.filter(r => r.exito).length,
      ajustesFallidos: resultados.filter(r => !r.exito).length,
      resultados,
    };
  }

  /**
   * Obtiene inventario valorizado
   */
  async obtenerInventarioValorizado(
    empresaId: number,
    filtros?: FiltrosReporteDto,
  ): Promise<InventarioValorizadoResponse> {
    const whereProductos: any = {
      empresaId,
      ...(filtros?.incluirInactivos ? {} : { estado: 'ACTIVO' }),
    };

    if (filtros?.categoriaId) {
      whereProductos.categoriaId = filtros.categoriaId;
    }

    // Para stock crítico, filtraremos después de obtener los datos
    // porque Prisma no maneja bien la comparación entre campos

    const productos = await this.prisma.producto.findMany({
      where: whereProductos,
      include: {
        categoria: true,
        unidadMedida: true,
        movimientosKardex: {
          orderBy: { fecha: 'desc' },
          take: 1,
        },
      },
      orderBy: { descripcion: 'asc' },
    });

    let productosAFiltrar = productos;

    // Filtrar stock crítico si es necesario
    if (filtros?.soloStockCritico) {
      productosAFiltrar = productos.filter(producto =>
        producto.stock === 0 ||
        (producto.stockMinimo && producto.stock <= producto.stockMinimo)
      );
    }

    const productosProcessados = productosAFiltrar.map(producto => {
      const costoPromedio = Number(producto.costoPromedio) || 0;
      const valorTotal = producto.stock * costoPromedio;

      return {
        id: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        stock: producto.stock,
        costoPromedio,
        valorTotal,
        stockMinimo: producto.stockMinimo || 0,
        stockMaximo: producto.stockMaximo || 0,
        categoria: producto.categoria ? {
          id: producto.categoria.id,
          nombre: producto.categoria.nombre,
        } : undefined,
        unidadMedida: {
          codigo: producto.unidadMedida.codigo,
          nombre: producto.unidadMedida.nombre,
        },
        ultimoMovimiento: producto.movimientosKardex[0] ? {
          fecha: producto.movimientosKardex[0].fecha,
          tipoMovimiento: producto.movimientosKardex[0].tipoMovimiento,
          concepto: producto.movimientosKardex[0].concepto,
        } : undefined,
      };
    });

    const resumen = {
      totalProductos: productosAFiltrar.length,
      valorTotalInventario: productosProcessados.reduce((sum, p) => sum + p.valorTotal, 0),
      productosStockCritico: productosAFiltrar.filter(p =>
        p.stock <= (p.stockMinimo || 0) && p.stock > 0
      ).length,
      productosStockCero: productosAFiltrar.filter(p => p.stock === 0).length,
    };

    return {
      productos: productosProcessados,
      resumen,
    };
  }

  /**
   * Calcular stock actual por producto (para validación)
   */
  async calcularStockActual(productoId: number, empresaId: number): Promise<number> {
    const movimientos = await this.prisma.movimientoKardex.findMany({
      where: { productoId, empresaId },
      orderBy: { fecha: 'desc' },
      take: 1,
    });

    if (movimientos.length === 0) {
      // Si no hay movimientos, obtener el stock actual del producto
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        select: { stock: true },
      });
      return producto?.stock || 0;
    }

    return movimientos[0].stockActual;
  }

  /**
   * Validar consistencia de stock
   */
  async validarConsistenciaStock(empresaId: number) {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, estado: 'ACTIVO' },
      select: { id: true, codigo: true, descripcion: true, stock: true },
    });

    const inconsistencias: Array<{
      productoId: number;
      codigo: string;
      descripcion: string;
      stockSistema: number;
      stockCalculado: number;
      diferencia: number;
    }> = [];

    for (const producto of productos) {
      const stockCalculado = await this.calcularStockActual(producto.id, empresaId);
      if (stockCalculado !== producto.stock) {
        inconsistencias.push({
          productoId: producto.id,
          codigo: producto.codigo,
          descripcion: producto.descripcion,
          stockSistema: producto.stock,
          stockCalculado,
          diferencia: producto.stock - stockCalculado,
        });
      }
    }

    return {
      productosRevisados: productos.length,
      inconsistenciasEncontradas: inconsistencias.length,
      inconsistencias,
    };
  }

  // Métodos privados auxiliares

  private async calcularResumenKardex(productoId: number, empresaId: number) {
    const movimientos = await this.prisma.movimientoKardex.findMany({
      where: { productoId, empresaId },
    });

    const totalIngresos = movimientos
      .filter(m => m.tipoMovimiento === 'INGRESO')
      .reduce((sum, m) => sum + m.cantidad, 0);

    const totalSalidas = movimientos
      .filter(m => m.tipoMovimiento === 'SALIDA')
      .reduce((sum, m) => sum + m.cantidad, 0);

    const totalAjustes = movimientos
      .filter(m => m.tipoMovimiento === 'AJUSTE')
      .reduce((sum, m) => sum + m.cantidad, 0);

    const stockActual = await this.calcularStockActual(productoId, empresaId);

    const producto = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: { costoPromedio: true },
    });

    const costoPromedio = Number(producto?.costoPromedio) || 0;
    const valorInventario = stockActual * costoPromedio;

    return {
      totalIngresos,
      totalSalidas,
      totalAjustes,
      stockActual,
      valorInventario,
    };
  }

  private async actualizarStockYCosto(
    productoId: number,
    nuevoStock: number,
    tipoMovimiento: string,
    costoUnitario?: number,
    cantidad?: number,
  ) {
    const dataUpdate: any = { stock: Math.max(0, nuevoStock) };

    // Actualizar costo promedio solo para ingresos
    if (tipoMovimiento === 'INGRESO' && costoUnitario && cantidad) {
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        select: { stock: true, costoPromedio: true },
      });

      if (producto) {
        const stockAnterior = producto.stock;
        const costoAnterior = Number(producto.costoPromedio) || 0;

        // Calcular costo promedio ponderado
        const valorAnterior = stockAnterior * costoAnterior;
        const valorNuevo = cantidad * costoUnitario;
        const stockNuevo = stockAnterior + cantidad;

        if (stockNuevo > 0) {
          const costoPromedio = (valorAnterior + valorNuevo) / stockNuevo;
          dataUpdate.costoPromedio = costoPromedio;
        }
      }
    }

    await this.prisma.producto.update({
      where: { id: productoId },
      data: dataUpdate,
    });
  }

  /**
   * Obtiene reporte de rotación de inventario
   */
  async obtenerReporteRotacion(
    empresaId: number,
    fechaInicio?: Date,
    fechaFin?: Date,
  ): Promise<ReporteRotacionResponse> {
    // Si no se proporcionan fechas, usar los últimos 12 meses
    const fechaFin_date = fechaFin || new Date();
    const fechaInicio_date = fechaInicio ||
      new Date(fechaFin_date.getFullYear() - 1, fechaFin_date.getMonth(), fechaFin_date.getDate());

    // Obtener productos activos
    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
      },
      include: {
        categoria: true,
        movimientosKardex: {
          where: {
            fecha: {
              gte: fechaInicio_date,
              lte: fechaFin_date,
            },
            tipoMovimiento: 'SALIDA', // Solo considerar salidas (ventas)
          },
        },
      },
    });

    const reporteProductos = productos.map(producto => {
      // Calcular ventas por períodos (últimos 3 meses)
      const ahora = new Date();
      const mes1 = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      const mes2 = new Date(ahora.getFullYear(), ahora.getMonth() - 2, 1);
      const mes3 = new Date(ahora.getFullYear(), ahora.getMonth() - 3, 1);

      const ventasPeriodo1 = producto.movimientosKardex
        .filter(m => m.fecha >= mes1)
        .reduce((sum, m) => sum + m.cantidad, 0);

      const ventasPeriodo2 = producto.movimientosKardex
        .filter(m => m.fecha >= mes2 && m.fecha < mes1)
        .reduce((sum, m) => sum + m.cantidad, 0);

      const ventasPeriodo3 = producto.movimientosKardex
        .filter(m => m.fecha >= mes3 && m.fecha < mes2)
        .reduce((sum, m) => sum + m.cantidad, 0);

      // Calcular rotación anual
      const totalVentas = producto.movimientosKardex
        .reduce((sum, m) => sum + m.cantidad, 0);

      const stockPromedio = producto.stock > 0 ? producto.stock : 1;
      const rotacionAnual = stockPromedio > 0 ? totalVentas / stockPromedio : 0;
      const diasInventario = rotacionAnual > 0 ? 365 / rotacionAnual : 365;

      // Clasificar rotación
      let clasificacion: 'ALTO' | 'MEDIO' | 'BAJO' | 'NULO' = 'NULO';
      if (rotacionAnual > 6) clasificacion = 'ALTO';
      else if (rotacionAnual > 2) clasificacion = 'MEDIO';
      else if (rotacionAnual > 0) clasificacion = 'BAJO';

      return {
        id: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        categoria: producto.categoria?.nombre,
        ventasUltimosPeriodos: {
          periodo1: ventasPeriodo1,
          periodo2: ventasPeriodo2,
          periodo3: ventasPeriodo3,
        },
        stockPromedio,
        rotacion: Math.round(rotacionAnual * 100) / 100,
        diasInventario: Math.round(diasInventario),
        clasificacion,
      };
    });

    // Calcular resumen general
    const rotacionPromedio = reporteProductos.length > 0
      ? reporteProductos.reduce((sum, p) => sum + p.rotacion, 0) / reporteProductos.length
      : 0;

    const diasInventarioPromedio = reporteProductos.length > 0
      ? reporteProductos.reduce((sum, p) => sum + p.diasInventario, 0) / reporteProductos.length
      : 0;

    const resumenGeneral = {
      rotacionPromedio: Math.round(rotacionPromedio * 100) / 100,
      diasInventarioPromedio: Math.round(diasInventarioPromedio),
      productosAltaRotacion: reporteProductos.filter(p => p.clasificacion === 'ALTO').length,
      productosMediaRotacion: reporteProductos.filter(p => p.clasificacion === 'MEDIO').length,
      productosBajaRotacion: reporteProductos.filter(p => p.clasificacion === 'BAJO').length,
    };

    return {
      productos: reporteProductos.sort((a, b) => b.rotacion - a.rotacion),
      resumenGeneral,
    };
  }

  /**
   * Obtiene análisis ABC de productos por ventas
   */
  async obtenerAnalisisABC(
    empresaId: number,
    fechaInicio?: Date,
    fechaFin?: Date,
  ) {
    const fechaFin_date = fechaFin || new Date();
    const fechaInicio_date = fechaInicio ||
      new Date(fechaFin_date.getFullYear(), fechaFin_date.getMonth() - 3, fechaFin_date.getDate());

    // Obtener ventas por producto en el período
    const ventasPorProducto = await this.prisma.movimientoKardex.groupBy({
      by: ['productoId'],
      where: {
        empresaId,
        tipoMovimiento: 'SALIDA',
        fecha: {
          gte: fechaInicio_date,
          lte: fechaFin_date,
        },
      },
      _sum: {
        cantidad: true,
        valorTotal: true,
      },
    });

    // Obtener información de productos
    const productosInfo = await this.prisma.producto.findMany({
      where: {
        id: { in: ventasPorProducto.map(v => v.productoId) },
        empresaId,
      },
      include: {
        categoria: true,
        unidadMedida: true,
      },
    });

    // Combinar datos y calcular porcentajes
    const productosConVentas = ventasPorProducto.map(venta => {
      const producto = productosInfo.find(p => p.id === venta.productoId);
      return {
        producto,
        cantidadVendida: venta._sum.cantidad || 0,
        valorVendido: venta._sum.valorTotal || 0,
      };
    }).filter(item => item.producto);

    // Ordenar por valor vendido (mayor a menor)
    productosConVentas.sort((a, b) => Number(b.valorVendido) - Number(a.valorVendido));

    const totalVentas = productosConVentas.reduce((sum, p) => sum + Number(p.valorVendido), 0);
    let acumuladoPorcentaje = 0;

    const productosClasificados = productosConVentas.map(item => {
      const porcentajeIndividual = totalVentas > 0 ? (Number(item.valorVendido) / totalVentas) * 100 : 0;
      acumuladoPorcentaje += porcentajeIndividual;

      let clasificacionABC: 'A' | 'B' | 'C' = 'C';
      if (acumuladoPorcentaje <= 80) clasificacionABC = 'A';
      else if (acumuladoPorcentaje <= 95) clasificacionABC = 'B';

      return {
        id: item.producto!.id,
        codigo: item.producto!.codigo,
        descripcion: item.producto!.descripcion,
        categoria: item.producto!.categoria?.nombre,
        cantidadVendida: Number(item.cantidadVendida),
        valorVendido: Number(item.valorVendido),
        porcentajeVentas: Math.round(porcentajeIndividual * 100) / 100,
        porcentajeAcumulado: Math.round(acumuladoPorcentaje * 100) / 100,
        clasificacionABC,
      };
    });

    const resumen = {
      totalProductos: productosClasificados.length,
      totalVentas,
      productosA: productosClasificados.filter(p => p.clasificacionABC === 'A').length,
      productosB: productosClasificados.filter(p => p.clasificacionABC === 'B').length,
      productosC: productosClasificados.filter(p => p.clasificacionABC === 'C').length,
      ventasA: productosClasificados.filter(p => p.clasificacionABC === 'A').reduce((sum, p) => sum + Number(p.valorVendido), 0),
      ventasB: productosClasificados.filter(p => p.clasificacionABC === 'B').reduce((sum, p) => sum + Number(p.valorVendido), 0),
      ventasC: productosClasificados.filter(p => p.clasificacionABC === 'C').reduce((sum, p) => sum + Number(p.valorVendido), 0),
    };

    return {
      productos: productosClasificados,
      resumen,
      periodo: {
        inicio: fechaInicio_date,
        fin: fechaFin_date,
      },
    };
  }

  /**
   * Obtiene productos con baja rotación o sin movimiento
   */
  async obtenerProductosObsoletos(
    empresaId: number,
    diasSinMovimiento: number = 90,
  ) {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - diasSinMovimiento);

    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        stock: { gt: 0 }, // Solo productos con stock
      },
      include: {
        categoria: true,
        unidadMedida: true,
        movimientosKardex: {
          where: {
            fecha: { gte: fechaLimite },
            tipoMovimiento: 'SALIDA',
          },
          orderBy: { fecha: 'desc' },
          take: 1,
        },
      },
    });

    const productosObsoletos = productos
      .filter(producto => producto.movimientosKardex.length === 0)
      .map(producto => {
        const costoPromedio = Number(producto.costoPromedio) || 0;
        const valorInmovilizado = producto.stock * costoPromedio;

        return {
          id: producto.id,
          codigo: producto.codigo,
          descripcion: producto.descripcion,
          categoria: producto.categoria?.nombre,
          stock: producto.stock,
          costoPromedio,
          valorInmovilizado,
          diasSinMovimiento,
          unidadMedida: {
            codigo: producto.unidadMedida.codigo,
            nombre: producto.unidadMedida.nombre,
          },
        };
      });

    const resumen = {
      totalProductosObsoletos: productosObsoletos.length,
      valorTotalInmovilizado: productosObsoletos.reduce((sum, p) => sum + p.valorInmovilizado, 0),
      stockTotalInmovilizado: productosObsoletos.reduce((sum, p) => sum + p.stock, 0),
    };

    return {
      productos: productosObsoletos.sort((a, b) => b.valorInmovilizado - a.valorInmovilizado),
      resumen,
      criterio: {
        diasSinMovimiento,
        fechaAnalisis: new Date(),
      },
    };
  }
}