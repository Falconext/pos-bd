import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import type { MovimientoKardex } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FiltrosKardexDto,
  FiltrosReporteDto,
  TipoMovimiento,
} from './dto/filtros-kardex.dto';
import {
  AjusteInventarioDto,
  AjusteMasivoDto,
  TipoAjuste,
} from './dto/ajuste-inventario.dto';
import { TrasladoKardexDto } from './dto/traslado-kardex.dto';
import {
  KardexProductoResponse,
  MovimientoKardexResponse,
  InventarioValorizadoResponse,
  ReporteRotacionResponse,
} from './dto/response-kardex.dto';
import { PdfGeneratorService } from '../comprobante/pdf-generator.service';
import { parseFechaSoloDia } from '../common/utils/fecha';
import { num, round3 } from '../common/utils/stock';

@Injectable()
export class KardexService {
  constructor(
    private prisma: PrismaService,
    private pdfGenerator: PdfGeneratorService,
  ) {}

  private readonly estadosSerieValidos = new Set([
    'DISPONIBLE',
    'VENDIDO',
    'RESERVADO',
    'BAJA',
  ]);
  private readonly estadosReclamoValidos = new Set([
    'ABIERTO',
    'EN_PROCESO',
    'RESUELTO',
    'CERRADO',
  ]);

  private normalizarSerie(numeroSerie: unknown) {
    const normalized = String(numeroSerie ?? '')
      .trim()
      .toUpperCase();
    if (!normalized) throw new BadRequestException('numeroSerie es requerido');
    return normalized;
  }

  private calcularGarantiaHasta(garantiaMeses: unknown) {
    if (garantiaMeses == null || garantiaMeses === '') return null;
    const meses = Number(garantiaMeses);
    if (!Number.isInteger(meses) || meses < 0) {
      throw new BadRequestException(
        'garantiaMeses debe ser un entero mayor o igual a 0',
      );
    }
    if (meses === 0) return null;
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() + meses);
    return fecha;
  }

  private validarEstadoSerie(estado?: unknown) {
    if (estado == null || estado === '') return undefined;
    const value = String(estado).trim().toUpperCase();
    if (!this.estadosSerieValidos.has(value)) {
      throw new BadRequestException(`Estado de serie inválido: ${estado}`);
    }
    return value;
  }

  private validarEstadoReclamo(estado?: unknown) {
    if (estado == null || estado === '') return undefined;
    const value = String(estado).trim().toUpperCase();
    if (!this.estadosReclamoValidos.has(value)) {
      throw new BadRequestException(`Estado de reclamo inválido: ${estado}`);
    }
    return value;
  }

  private async validarProductoEmpresa(empresaId: number, productoId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true },
    });
    if (!producto)
      throw new BadRequestException('Producto no encontrado para esta empresa');
  }

  private async validarCompraEmpresa(
    empresaId: number,
    compraId?: unknown,
    compraDetalleId?: unknown,
  ) {
    if (compraId == null && compraDetalleId == null) return;

    const parsedCompraId =
      compraId != null && compraId !== '' ? Number(compraId) : undefined;
    const parsedDetalleId =
      compraDetalleId != null && compraDetalleId !== ''
        ? Number(compraDetalleId)
        : undefined;

    if (parsedCompraId != null && !Number.isInteger(parsedCompraId)) {
      throw new BadRequestException('compraId inválido');
    }
    if (parsedDetalleId != null && !Number.isInteger(parsedDetalleId)) {
      throw new BadRequestException('compraDetalleId inválido');
    }

    if (parsedCompraId != null) {
      const compra = await this.prisma.compra.findFirst({
        where: { id: parsedCompraId, empresaId },
        select: { id: true },
      });
      if (!compra)
        throw new BadRequestException('Compra no encontrada para esta empresa');
    }

    if (parsedDetalleId != null) {
      const detalle = await this.prisma.detalleCompra.findFirst({
        where: {
          id: parsedDetalleId,
          compra: {
            empresaId,
            ...(parsedCompraId != null ? { id: parsedCompraId } : {}),
          },
        },
        select: { id: true },
      });
      if (!detalle)
        throw new BadRequestException(
          'Detalle de compra no encontrado para esta empresa',
        );
    }
  }

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
    sedeId: number; // Changed to required
    lote?: string;
    fechaVencimiento?: Date;
  }) {
    // Obtener el producto stock en la sede
    let productoStock = await this.prisma.productoStock.findUnique({
      where: {
        productoId_sedeId: {
          productoId: data.productoId,
          sedeId: data.sedeId,
        },
      },
      include: { producto: { select: { costoPromedio: true } } },
    });

    if (!productoStock) {
      const stockFallback = await this.prisma.producto.findUnique({
        where: { id: data.productoId },
        select: { stock: true, costoPromedio: true },
      });
      await this.prisma.productoStock.upsert({
        where: {
          productoId_sedeId: {
            productoId: data.productoId,
            sedeId: data.sedeId,
          },
        },
        create: {
          productoId: data.productoId,
          sedeId: data.sedeId,
          stock: stockFallback?.stock ?? 0,
          stockMinimo: 0,
        },
        update: {},
      });
      productoStock = await this.prisma.productoStock.findUnique({
        where: {
          productoId_sedeId: {
            productoId: data.productoId,
            sedeId: data.sedeId,
          },
        },
        include: { producto: { select: { costoPromedio: true } } },
      });
      if (!productoStock)
        throw new NotFoundException(
          'No se pudo crear el stock para esta sede y producto',
        );
    }

    const stockAnterior = num(productoStock.stock);
    const costoPromedio = Number(productoStock.producto.costoPromedio) || 0;
    let stockActual = stockAnterior;
    const cantidadNum = round3(num(data.cantidad));

    // Calcular nuevo stock según el tipo de movimiento
    switch (data.tipoMovimiento) {
      case 'INGRESO':
        stockActual += cantidadNum;
        break;
      case 'SALIDA':
        stockActual -= cantidadNum;
        break;
      case 'AJUSTE':
        // Para ajustes, la cantidad puede ser positiva o negativa (delta)
        stockActual += cantidadNum;
        break;
      case 'TRANSFERENCIA':
        // Lógica específica para transferencias
        stockActual -= cantidadNum;
        break;
    }
    stockActual = round3(stockActual);

    // Calcular costo unitario si no se proporciona
    let costoUnitario = data.costoUnitario;
    if (!costoUnitario && data.tipoMovimiento === 'INGRESO') {
      costoUnitario = costoPromedio;
    }

    const valorTotal = costoUnitario ? costoUnitario * cantidadNum : null;

    // Crear el movimiento
    const movimiento = await this.prisma.movimientoKardex.create({
      data: {
        productoId: data.productoId,
        empresaId: data.empresaId,
        tipoMovimiento: data.tipoMovimiento as any,
        concepto: data.concepto,
        cantidad: cantidadNum,
        stockAnterior: round3(stockAnterior),
        stockActual,
        costoUnitario: costoUnitario || null,
        valorTotal: valorTotal || null,
        sedeId: data.sedeId, // Guardar la sede en el movimiento
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
          },
        },
      },
    });

    // Actualizar el stock en la sede y costo promedio del producto
    await this.actualizarStockYCosto(
      data.productoId,
      data.sedeId,
      stockActual,
      data.tipoMovimiento,
      costoUnitario,
      data.cantidad,
    );

    return movimiento;
  }

  /**
   * Obtiene el kardex completo de un producto
   */
  async obtenerKardexProducto(
    productoId: number,
    empresaId: number,
    filtros?: FiltrosKardexDto,
    sedeId?: number,
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
      ...(sedeId ? { sedeId } : {}),
    };

    if (filtros?.fechaInicio || filtros?.fechaFin) {
      const toLocalStart = (s: string) =>
        /T/.test(s) ? new Date(s) : new Date(`${s}T00:00:00.000-05:00`);
      const toLocalEnd = (s: string) =>
        /T/.test(s) ? new Date(s) : new Date(`${s}T23:59:59.999-05:00`);
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
    const resumen = await this.calcularResumenKardex(
      productoId,
      empresaId,
      sedeId,
    );

    return {
      producto: {
        id: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        stock: num(producto.stock),
        stockMinimo: producto.stockMinimo || 0,
        stockMaximo: producto.stockMaximo || 0,
        costoPromedio: Number(producto.costoPromedio) || 0,
        unidadMedida: {
          codigo: producto.unidadMedida.codigo,
          nombre: producto.unidadMedida.nombre,
        },
        categoria: producto.categoria
          ? {
              id: producto.categoria.id,
              nombre: producto.categoria.nombre,
            }
          : undefined,
      },
      movimientos: movimientos.map((mov) => ({
        ...mov,
        cantidad: num(mov.cantidad),
        stockAnterior: num(mov.stockAnterior),
        stockActual: num(mov.stockActual),
        costoUnitario: mov.costoUnitario
          ? Number(mov.costoUnitario)
          : undefined,
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
  async obtenerKardexGeneral(
    empresaId: number,
    filtros?: FiltrosKardexDto,
    sedeId?: number,
  ) {
    const whereMovimientos: any = { empresaId, ...(sedeId ? { sedeId } : {}) };

    // Aplicar filtros
    if (filtros?.fechaInicio || filtros?.fechaFin) {
      const toLocalStart = (s: string) =>
        /T/.test(s) ? new Date(s) : new Date(`${s}T00:00:00.000-05:00`);
      const toLocalEnd = (s: string) =>
        /T/.test(s) ? new Date(s) : new Date(`${s}T23:59:59.999-05:00`);
      whereMovimientos.fecha = {};
      if (filtros.fechaInicio)
        whereMovimientos.fecha.gte = toLocalStart(filtros.fechaInicio);
      if (filtros.fechaFin)
        whereMovimientos.fecha.lte = toLocalEnd(filtros.fechaFin);
    }

    if (filtros?.productoId) whereMovimientos.productoId = filtros.productoId;
    if (filtros?.tipoMovimiento)
      whereMovimientos.tipoMovimiento = filtros.tipoMovimiento;
    if (filtros?.concepto) {
      whereMovimientos.concepto = {
        contains: filtros.concepto,
        mode: 'insensitive',
      };
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
          comprobante: {
            select: { id: true, tipoDoc: true, serie: true, correlativo: true },
          },
          sede: { select: { id: true, nombre: true } },
        },
        orderBy: { fecha: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.movimientoKardex.count({ where: whereMovimientos }),
    ]);

    // Mapear movimientos con campos calculados
    const movimientosMapeados = movimientos.map((mov) => {
      // Obtener costo unitario: si no existe en el movimiento, usar costo promedio del producto
      const costoUnitarioMovimiento = mov.costoUnitario
        ? Number(mov.costoUnitario)
        : null;
      const costoPromedioProducto =
        mov.producto && mov.producto.costoPromedio
          ? Number(mov.producto.costoPromedio)
          : 0;
      const costoFinal = costoUnitarioMovimiento || costoPromedioProducto;

      // Calcular valor total si no existe
      const valorTotal = mov.valorTotal
        ? Number(mov.valorTotal)
        : costoFinal * num(mov.cantidad);

      // Calcular ganancia unitaria
      const precioVenta = mov.producto
        ? Number(mov.producto.precioUnitario || 0)
        : 0;
      const gananciaUnidad =
        precioVenta > 0 && costoFinal > 0 ? precioVenta - costoFinal : 0;

      return {
        ...mov,
        costoUnitario: costoFinal,
        valorTotal: valorTotal,
        gananciaUnidad: gananciaUnidad,
        producto: mov.producto
          ? {
              ...mov.producto,
              precioUnitario: Number(mov.producto.precioUnitario || 0),
              costoPromedio: Number(mov.producto.costoPromedio || 0),
            }
          : null,
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
    sedeIdParam?: number,
  ) {
    // 0. Resolver Sede — prefer the user's session sedeId, then DTO, then principal
    let sedeId = sedeIdParam || ajusteDto.sedeId;
    if (!sedeId) {
      const sede = await this.prisma.sede.findFirst({
        where: { empresaId, esPrincipal: true },
      });
      if (!sede)
        throw new NotFoundException(
          'No se encontró sede principal para el ajuste',
        );
      sedeId = sede.id;
    }

    // Verificar que el producto existe
    const producto = await this.prisma.producto.findFirst({
      where: { id: ajusteDto.productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    let cantidad: number;
    let nuevoStock: number;
    const stockProd = num(producto.stock);

    switch (ajusteDto.tipoAjuste) {
      case TipoAjuste.POSITIVO:
        cantidad = num(ajusteDto.cantidad);
        nuevoStock = round3(stockProd + cantidad);
        break;
      case TipoAjuste.NEGATIVO: {
        const descuentoAplicado = Math.min(stockProd, num(ajusteDto.cantidad));
        cantidad = -descuentoAplicado;
        nuevoStock = round3(stockProd - descuentoAplicado);
        break;
      }
      case TipoAjuste.CORRECCION:
        cantidad = round3(num(ajusteDto.cantidad) - stockProd);
        nuevoStock = num(ajusteDto.cantidad);
        break;
    }

    // Registrar el movimiento
    const movimiento = await this.registrarMovimiento({
      productoId: ajusteDto.productoId,
      empresaId,
      sedeId, // Pass resolved sedeId
      tipoMovimiento: 'AJUSTE',
      concepto: `Ajuste ${ajusteDto.tipoAjuste.toLowerCase()}: ${ajusteDto.motivo}`,
      cantidad,
      costoUnitario: ajusteDto.costoUnitario,
      usuarioId,
      observacion: ajusteDto.observacion,
      lote: ajusteDto.lote,
      fechaVencimiento: ajusteDto.fechaVencimiento
        ? parseFechaSoloDia(ajusteDto.fechaVencimiento)
        : undefined,
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
    sedeIdParam?: number,
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
            observacion:
              ajusteMasivoDto.observacionGeneral || ajuste.observacion,
          },
          empresaId,
          usuarioId,
          sedeIdParam,
        );
        resultados.push({
          productoId: ajuste.productoId,
          exito: true,
          movimiento: resultado,
        });
      } catch (error: any) {
        resultados.push({
          productoId: ajuste.productoId,
          exito: false,
          error: error.message,
        });
      }
    }

    return {
      ajustesRealizados: resultados.filter((r) => r.exito).length,
      ajustesFallidos: resultados.filter((r) => !r.exito).length,
      resultados,
    };
  }

  /**
   * Obtiene inventario valorizado
   */
  async obtenerInventarioValorizado(
    empresaId: number,
    filtros?: FiltrosReporteDto,
    sedeId?: number,
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

    const productos = await (this.prisma.producto.findMany({
      where: whereProductos,
      include: {
        categoria: true,
        unidadMedida: true,
        stocks: sedeId ? { where: { sedeId } } : true,
        movimientosKardex: {
          where: sedeId ? { sedeId } : undefined,
          orderBy: { fecha: 'desc' },
          take: 1,
        },
      },
      orderBy: { descripcion: 'asc' },
    }) as Promise<any[]>);

    let productosAFiltrar = productos;

    // Filtrar stock crítico si es necesario
    if (filtros?.soloStockCritico) {
      productosAFiltrar = productos.filter(
        (producto) =>
          num(producto.stock) === 0 ||
          (producto.stockMinimo && num(producto.stock) <= producto.stockMinimo),
      );
    }

    const productosProcessados = productosAFiltrar.map((producto: any) => {
      // Use branch specific stock if requested, otherwise global stock.
      // Normalizamos con num() porque producto.stock es Decimal y `=== 0` fallaría.
      const stockUsar = sedeId
        ? producto.stocks && producto.stocks.length > 0
          ? num(producto.stocks[0].stock)
          : 0
        : num(producto.stock);

      const costoPromedio = Number(producto.costoPromedio) || 0;
      const valorTotal = stockUsar * costoPromedio;

      return {
        id: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        stock: stockUsar,
        costoPromedio,
        valorTotal,
        stockMinimo: producto.stockMinimo || 0,
        stockMaximo: producto.stockMaximo || 0,
        categoria: producto.categoria
          ? {
              id: producto.categoria.id,
              nombre: producto.categoria.nombre,
            }
          : undefined,
        unidadMedida: producto.unidadMedida
          ? {
              codigo: producto.unidadMedida.codigo,
              nombre: producto.unidadMedida.nombre,
            }
          : { codigo: '', nombre: '' },
        ultimoMovimiento: producto.movimientosKardex?.[0]
          ? {
              fecha: producto.movimientosKardex[0].fecha,
              tipoMovimiento: producto.movimientosKardex[0].tipoMovimiento,
              concepto: producto.movimientosKardex[0].concepto,
            }
          : undefined,
      };
    });

    // Calculamos el resumen sobre productosProcessados: su `stock` ya es numérico
    // (num()) y respeta la sede activa, a diferencia de productosAFiltrar (Decimal).
    const resumen = {
      totalProductos: productosProcessados.length,
      valorTotalInventario: productosProcessados.reduce(
        (sum, p) => sum + p.valorTotal,
        0,
      ),
      productosStockCritico: productosProcessados.filter(
        (p) => p.stock <= (p.stockMinimo || 0) && p.stock > 0,
      ).length,
      productosStockCero: productosProcessados.filter((p) => p.stock === 0)
        .length,
    };

    return {
      productos: productosProcessados,
      resumen,
    };
  }

  /**
   * Calcular stock actual por producto (para validación)
   */
  async calcularStockActual(
    productoId: number,
    empresaId: number,
    sedeId?: number,
  ): Promise<number> {
    const movimientos = await this.prisma.movimientoKardex.findMany({
      where: { productoId, empresaId, ...(sedeId ? { sedeId } : {}) },
      orderBy: { fecha: 'desc' },
      take: 1,
    });

    if (movimientos.length === 0) {
      // Si no hay movimientos, obtener el stock actual del producto
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        select: { stock: true },
      });
      return num(producto?.stock);
    }

    return num(movimientos[0].stockActual);
  }

  /**
   * Validar consistencia de stock
   */
  async validarConsistenciaStock(empresaId: number, sedeId?: number) {
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
      const stockCalculado = await this.calcularStockActual(
        producto.id,
        empresaId,
        sedeId,
      );
      const stockSistema = num(producto.stock);
      if (stockCalculado !== stockSistema) {
        inconsistencias.push({
          productoId: producto.id,
          codigo: producto.codigo,
          descripcion: producto.descripcion,
          stockSistema,
          stockCalculado,
          diferencia: round3(stockSistema - stockCalculado),
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

  private async calcularResumenKardex(
    productoId: number,
    empresaId: number,
    sedeId?: number,
  ) {
    const movimientos = await this.prisma.movimientoKardex.findMany({
      where: { productoId, empresaId, ...(sedeId ? { sedeId } : {}) },
    });

    const totalIngresos = movimientos
      .filter((m) => m.tipoMovimiento === 'INGRESO')
      .reduce((sum, m) => sum + num(m.cantidad), 0);

    const totalSalidas = movimientos
      .filter((m) => m.tipoMovimiento === 'SALIDA')
      .reduce((sum, m) => sum + num(m.cantidad), 0);

    const totalAjustes = movimientos
      .filter((m) => m.tipoMovimiento === 'AJUSTE')
      .reduce((sum, m) => sum + num(m.cantidad), 0);

    const stockActual = await this.calcularStockActual(
      productoId,
      empresaId,
      sedeId,
    );

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
    sedeId: number,
    nuevoStock: number,
    tipoMovimiento: string,
    costoUnitario?: number,
    cantidad?: number,
  ) {
    // Actualizar stock en la sede específica
    await this.prisma.productoStock.update({
      where: { productoId_sedeId: { productoId, sedeId } },
      data: { stock: round3(Math.max(0, nuevoStock)) },
    });

    // Sincronizar el campo 'stock' global en Producto (suma de todas las sedes) para que las
    // notificaciones de stock mínimo y otras consultas legacy lean el valor correcto.
    const total = await this.prisma.productoStock.aggregate({
      where: { productoId },
      _sum: { stock: true },
    });
    await this.prisma.producto.update({
      where: { id: productoId },
      data: { stock: round3(num(total._sum.stock)) },
    });

    // Actualizar costo promedio solo para ingresos (afecta al producto globalmente)
    if (tipoMovimiento === 'INGRESO' && costoUnitario && cantidad) {
      // Recalcular costo promedio global
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        select: { costoPromedio: true },
      });
      // Obtener stock TOTAL de todas las sedes para el ponderado
      const totalStock = await this.prisma.productoStock.aggregate({
        where: { productoId },
        _sum: { stock: true },
      });
      const stockTotalGlobal = num(totalStock._sum.stock); // Este es el stock NUEVO total ya actualizado en la línea anterior?
      // Espera, acabamos de actualizar el stock de la sede.
      // El stockAnteriorGlobal seria stockTotalGlobal - cantidad.

      if (producto) {
        const stockActualGlobal = stockTotalGlobal;
        const stockAnteriorGlobal = stockActualGlobal - cantidad;
        const costoAnterior = Number(producto.costoPromedio) || 0;

        // Calcular costo promedio ponderado
        const valorAnterior = stockAnteriorGlobal * costoAnterior;
        const valorNuevo = cantidad * costoUnitario;

        if (stockActualGlobal > 0) {
          const costoPromedio =
            (valorAnterior + valorNuevo) / stockActualGlobal;
          await this.prisma.producto.update({
            where: { id: productoId },
            data: { costoPromedio },
          });
        }
      }
    }
  }

  /**
   * Obtiene reporte de rotación de inventario
   */
  async obtenerReporteRotacion(
    empresaId: number,
    fechaInicio?: Date,
    fechaFin?: Date,
    sedeId?: number,
  ): Promise<ReporteRotacionResponse> {
    // Si no se proporcionan fechas, usar los últimos 12 meses
    const fechaFin_date = fechaFin || new Date();
    const fechaInicio_date =
      fechaInicio ||
      new Date(
        fechaFin_date.getFullYear() - 1,
        fechaFin_date.getMonth(),
        fechaFin_date.getDate(),
      );

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

    const reporteProductos = productos.map((producto) => {
      // Calcular ventas por períodos (últimos 3 meses)
      const ahora = new Date();
      const mes1 = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      const mes2 = new Date(ahora.getFullYear(), ahora.getMonth() - 2, 1);
      const mes3 = new Date(ahora.getFullYear(), ahora.getMonth() - 3, 1);

      const ventasPeriodo1 = producto.movimientosKardex
        .filter((m) => m.fecha >= mes1)
        .reduce((sum, m) => sum + num(m.cantidad), 0);

      const ventasPeriodo2 = producto.movimientosKardex
        .filter((m) => m.fecha >= mes2 && m.fecha < mes1)
        .reduce((sum, m) => sum + num(m.cantidad), 0);

      const ventasPeriodo3 = producto.movimientosKardex
        .filter((m) => m.fecha >= mes3 && m.fecha < mes2)
        .reduce((sum, m) => sum + num(m.cantidad), 0);

      // Calcular rotación anual
      const totalVentas = producto.movimientosKardex.reduce(
        (sum, m) => sum + num(m.cantidad),
        0,
      );

      const stockProdNum = num(producto.stock);
      const stockPromedio = stockProdNum > 0 ? stockProdNum : 1;
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
    const rotacionPromedio =
      reporteProductos.length > 0
        ? reporteProductos.reduce((sum, p) => sum + p.rotacion, 0) /
          reporteProductos.length
        : 0;

    const diasInventarioPromedio =
      reporteProductos.length > 0
        ? reporteProductos.reduce((sum, p) => sum + p.diasInventario, 0) /
          reporteProductos.length
        : 0;

    const resumenGeneral = {
      rotacionPromedio: Math.round(rotacionPromedio * 100) / 100,
      diasInventarioPromedio: Math.round(diasInventarioPromedio),
      productosAltaRotacion: reporteProductos.filter(
        (p) => p.clasificacion === 'ALTO',
      ).length,
      productosMediaRotacion: reporteProductos.filter(
        (p) => p.clasificacion === 'MEDIO',
      ).length,
      productosBajaRotacion: reporteProductos.filter(
        (p) => p.clasificacion === 'BAJO',
      ).length,
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
    sedeId?: number,
  ) {
    const fechaFin_date = fechaFin || new Date();
    const fechaInicio_date =
      fechaInicio ||
      new Date(
        fechaFin_date.getFullYear(),
        fechaFin_date.getMonth() - 3,
        fechaFin_date.getDate(),
      );

    // Obtener ventas por producto en el período
    const ventasPorProducto = await this.prisma.movimientoKardex.groupBy({
      by: ['productoId'],
      where: {
        empresaId,
        ...(sedeId ? { sedeId } : {}),
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
        id: { in: ventasPorProducto.map((v) => v.productoId) },
        empresaId,
      },
      include: {
        categoria: true,
        unidadMedida: true,
      },
    });

    // Combinar datos y calcular porcentajes
    const productosConVentas = ventasPorProducto
      .map((venta) => {
        const producto = productosInfo.find((p) => p.id === venta.productoId);
        return {
          producto,
          cantidadVendida: venta._sum.cantidad || 0,
          valorVendido: venta._sum.valorTotal || 0,
        };
      })
      .filter((item) => item.producto);

    // Ordenar por valor vendido (mayor a menor)
    productosConVentas.sort(
      (a, b) => Number(b.valorVendido) - Number(a.valorVendido),
    );

    const totalVentas = productosConVentas.reduce(
      (sum, p) => sum + Number(p.valorVendido),
      0,
    );
    let acumuladoPorcentaje = 0;

    const productosClasificados = productosConVentas.map((item) => {
      const porcentajeIndividual =
        totalVentas > 0 ? (Number(item.valorVendido) / totalVentas) * 100 : 0;
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
      productosA: productosClasificados.filter(
        (p) => p.clasificacionABC === 'A',
      ).length,
      productosB: productosClasificados.filter(
        (p) => p.clasificacionABC === 'B',
      ).length,
      productosC: productosClasificados.filter(
        (p) => p.clasificacionABC === 'C',
      ).length,
      ventasA: productosClasificados
        .filter((p) => p.clasificacionABC === 'A')
        .reduce((sum, p) => sum + Number(p.valorVendido), 0),
      ventasB: productosClasificados
        .filter((p) => p.clasificacionABC === 'B')
        .reduce((sum, p) => sum + Number(p.valorVendido), 0),
      ventasC: productosClasificados
        .filter((p) => p.clasificacionABC === 'C')
        .reduce((sum, p) => sum + Number(p.valorVendido), 0),
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
    sedeId?: number,
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
      .filter((producto) => producto.movimientosKardex.length === 0)
      .map((producto) => {
        const costoPromedio = Number(producto.costoPromedio) || 0;
        const stockProd = num(producto.stock);
        const valorInmovilizado = stockProd * costoPromedio;

        return {
          id: producto.id,
          codigo: producto.codigo,
          descripcion: producto.descripcion,
          categoria: producto.categoria?.nombre,
          stock: stockProd,
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
      valorTotalInmovilizado: productosObsoletos.reduce(
        (sum, p) => sum + p.valorInmovilizado,
        0,
      ),
      stockTotalInmovilizado: productosObsoletos.reduce(
        (sum, p) => sum + p.stock,
        0,
      ),
    };

    return {
      productos: productosObsoletos.sort(
        (a, b) => b.valorInmovilizado - a.valorInmovilizado,
      ),
      resumen,
      criterio: {
        diasSinMovimiento,
        fechaAnalisis: new Date(),
      },
    };
  }

  /**
   * Realiza el traslado de productos entre sedes
   */
  async realizarTraslado(
    dto: TrasladoKardexDto,
    empresaId: number,
    usuarioId: number,
  ) {
    const { sedeOrigenId, sedeDestinoId, items, observacion } = dto;

    if (sedeOrigenId === sedeDestinoId) {
      throw new BadRequestException(
        'La sede de origen y destino no pueden ser iguales',
      );
    }

    // Obtener nombres de las sedes para los conceptos
    const [sedeOrigen, sedeDestino] = await Promise.all([
      this.prisma.sede.findUnique({
        where: { id: sedeOrigenId },
        select: { nombre: true },
      }),
      this.prisma.sede.findUnique({
        where: { id: sedeDestinoId },
        select: { nombre: true },
      }),
    ]);

    if (!sedeOrigen || !sedeDestino) {
      throw new BadRequestException('Una o ambas sedes no existen');
    }

    return await this.prisma.$transaction(async (tx) => {
      const resultados: Array<{
        productoId: number;
        movSalida: MovimientoKardex;
        movIngreso: MovimientoKardex;
      }> = [];

      for (const item of items) {
        // 1. Obtener stock en sede origen
        let stockOrigen = await tx.productoStock.findUnique({
          where: {
            productoId_sedeId: {
              productoId: item.productoId,
              sedeId: sedeOrigenId,
            },
          },
          include: { producto: true },
        });

        // Si no existe ProductoStock para la sede origen (producto legado anterior a multi-sede),
        // crear el registro con stock 0. Usar producto.stock global sería incorrecto porque ese
        // campo puede estar inflado (suma de todas las sedes). El check de stock insuficiente
        // fallará correctamente y le indicará al usuario que ajuste el stock de esa sede primero.
        if (!stockOrigen) {
          const producto = await tx.producto.findUnique({
            where: { id: item.productoId },
            include: { unidadMedida: true },
          });
          if (producto) {
            stockOrigen = await tx.productoStock.create({
              data: {
                productoId: item.productoId,
                sedeId: sedeOrigenId,
                stock: 0,
                stockMinimo: producto.stockMinimo || 0,
              },
              include: { producto: true },
            });
          }
        }

        if (!stockOrigen || num(stockOrigen.stock) < num(item.cantidad)) {
          throw new BadRequestException(
            `Stock insuficiente en ${sedeOrigen.nombre} para el producto ${stockOrigen?.producto?.descripcion || item.productoId}`,
          );
        }

        // 2. Registrar SALIDA en sede origen
        const movSalida = await tx.movimientoKardex.create({
          data: {
            productoId: item.productoId,
            empresaId,
            tipoMovimiento: 'SALIDA',
            concepto: `Traslado a ${sedeDestino.nombre}`,
            cantidad: item.cantidad,
            stockAnterior: num(stockOrigen.stock),
            stockActual: round3(num(stockOrigen.stock) - num(item.cantidad)),
            costoUnitario: stockOrigen.producto.costoPromedio,
            valorTotal:
              Number(stockOrigen.producto.costoPromedio) * num(item.cantidad),
            sedeId: sedeOrigenId,
            usuarioId,
            observacion,
            lote: item.lote,
          },
        });

        // 3. Obtener/Crear stock en sede destino (upsert garantiza que el registro exista)
        //    Se usa upsert para evitar la condición de carrera entre findUnique + create separados.
        await tx.productoStock.upsert({
          where: {
            productoId_sedeId: {
              productoId: item.productoId,
              sedeId: sedeDestinoId,
            },
          },
          create: {
            productoId: item.productoId,
            sedeId: sedeDestinoId,
            stock: 0,
            stockMinimo: 0,
          },
          update: {}, // No sobreescribir si ya existe
        });

        // Re-leer el stock REAL de la sede destino después del upsert para evitar valores obsoletos
        const stockDestinoActual = await tx.productoStock.findUnique({
          where: {
            productoId_sedeId: {
              productoId: item.productoId,
              sedeId: sedeDestinoId,
            },
          },
        });

        const stockAnteriorDestino = num(stockDestinoActual?.stock);

        // 4. Registrar INGRESO en sede destino con el stock real leído
        const movIngreso = await tx.movimientoKardex.create({
          data: {
            productoId: item.productoId,
            empresaId,
            tipoMovimiento: 'INGRESO',
            concepto: `Traslado desde ${sedeOrigen.nombre}`,
            cantidad: item.cantidad,
            stockAnterior: stockAnteriorDestino,
            stockActual: round3(stockAnteriorDestino + num(item.cantidad)),
            costoUnitario: stockOrigen.producto.costoPromedio,
            valorTotal:
              Number(stockOrigen.producto.costoPromedio) * num(item.cantidad),
            sedeId: sedeDestinoId,
            usuarioId,
            observacion,
            lote: item.lote,
          },
        });

        // 5. Actualizar stocks físicos usando increment para garantizar atomicidad
        //    Evita condiciones de carrera al no depender del valor leído en memoria.
        await tx.productoStock.update({
          where: { id: stockOrigen.id },
          data: { stock: { decrement: item.cantidad } },
        });

        await tx.productoStock.update({
          where: {
            productoId_sedeId: {
              productoId: item.productoId,
              sedeId: sedeDestinoId,
            },
          },
          data: { stock: { increment: item.cantidad } },
        });

        resultados.push({ productoId: item.productoId, movSalida, movIngreso });
      }

      // Sincronizar stock global del producto (suma de todas las sedes)
      for (const item of items) {
        const totalStock = await tx.productoStock.aggregate({
          where: { productoId: item.productoId },
          _sum: { stock: true },
        });
        await tx.producto.update({
          where: { id: item.productoId },
          data: { stock: totalStock._sum.stock ?? 0 },
        });
      }

      return resultados;
    });
  }

  /**
   * Libro de Control de Psicotrópicos y Estupefacientes (DS 023-2001-SA).
   * Combina entradas (compras) y salidas (comprobantes) de productos controlados.
   * Devuelve movimientos ordenados por fecha con saldo corrido por producto.
   */
  async obtenerLibroControlPsicotropicos(params: {
    empresaId: number;
    fechaInicio: Date;
    fechaFin: Date;
    productoId?: number;
  }) {
    const { empresaId, fechaInicio, fechaFin, productoId } = params;

    const productoWhere: any = { empresaId, controlado: true };
    if (productoId) productoWhere.id = productoId;

    // ── ENTRADAS desde Compras ─────────────────────────────────
    const entradas = await this.prisma.detalleCompra.findMany({
      where: {
        compra: {
          empresaId,
          fechaEmision: { gte: fechaInicio, lte: fechaFin },
        },
        productoId: { not: null },
        producto: productoWhere,
      },
      include: {
        compra: {
          include: {
            proveedor: { select: { nombre: true, nroDoc: true } },
          },
        },
        producto: {
          select: {
            id: true,
            descripcion: true,
            concentracion: true,
            presentacion: true,
          },
        },
      },
      orderBy: { compra: { fechaEmision: 'asc' } },
    });

    // ── SALIDAS desde Comprobantes ─────────────────────────────
    const salidas = await this.prisma.detalleComprobante.findMany({
      where: {
        comprobante: {
          empresaId,
          fechaEmision: { gte: fechaInicio, lte: fechaFin },
        },
        productoId: { not: null },
        producto: productoWhere,
      },
      include: {
        comprobante: {
          select: { fechaEmision: true, serie: true, correlativo: true },
        },
        producto: {
          select: {
            id: true,
            descripcion: true,
            concentracion: true,
            presentacion: true,
          },
        },
        lote: { select: { lote: true } },
      },
      orderBy: { comprobante: { fechaEmision: 'asc' } },
    });

    // ── Combinar y calcular saldo corrido por producto ─────────
    type Movimiento = {
      fecha: Date;
      tipo: 'ENTRADA' | 'SALIDA';
      proveedor?: string;
      proveedorDoc?: string;
      documento?: string;
      paciente?: string;
      dniPaciente?: string;
      nombrePaciente?: string;
      numeroReceta?: string;
      medico?: string;
      productoId: number;
      productoNombre: string;
      concentracion: string | null;
      formaFarmaceutica: string | null;
      lote?: string;
      cantidad: number;
      saldo?: number;
    };

    const movimientos: Movimiento[] = [
      ...entradas.map((e) => ({
        fecha: e.compra.fechaEmision,
        tipo: 'ENTRADA' as const,
        proveedor: e.compra.proveedor.nombre,
        proveedorDoc: e.compra.proveedor.nroDoc ?? undefined,
        documento: `${e.compra.serie}-${e.compra.numero}`,
        productoId: e.productoId!,
        productoNombre: e.producto!.descripcion,
        concentracion: (e.producto as any).concentracion ?? null,
        formaFarmaceutica: (e.producto as any).presentacion ?? null,
        lote: e.lote ?? undefined,
        cantidad: Number(e.cantidad),
      })),
      ...salidas.map((s) => ({
        fecha: s.comprobante.fechaEmision,
        tipo: 'SALIDA' as const,
        paciente: (s as any).nombrePaciente ?? s.dniPaciente ?? undefined,
        dniPaciente: s.dniPaciente ?? undefined,
        nombrePaciente: (s as any).nombrePaciente ?? undefined,
        numeroReceta: s.numeroReceta ?? undefined,
        medico: s.medicoNombre ?? undefined,
        documento: `${s.comprobante.serie}-${s.comprobante.correlativo}`,
        productoId: s.productoId!,
        productoNombre: s.producto!.descripcion,
        concentracion: (s.producto as any).concentracion ?? null,
        formaFarmaceutica: (s.producto as any).presentacion ?? null,
        lote: s.lote?.lote ?? undefined,
        cantidad: Number(s.cantidad),
      })),
    ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    // Saldo inicial por producto: suma de entradas - salidas ANTES del período filtrado
    const entradasPrevias = await this.prisma.detalleCompra.findMany({
      where: {
        compra: { empresaId, fechaEmision: { lt: fechaInicio } },
        productoId: { not: null },
        producto: productoWhere,
      },
      select: { productoId: true, cantidad: true },
    });
    const salidasPrevias = await this.prisma.detalleComprobante.findMany({
      where: {
        comprobante: { empresaId, fechaEmision: { lt: fechaInicio } },
        productoId: { not: null },
        producto: productoWhere,
      },
      select: { productoId: true, cantidad: true },
    });

    const saldoPorProducto = new Map<number, number>();
    for (const e of entradasPrevias) {
      const pid = e.productoId!;
      saldoPorProducto.set(
        pid,
        (saldoPorProducto.get(pid) ?? 0) + Number(e.cantidad),
      );
    }
    for (const s of salidasPrevias) {
      const pid = s.productoId!;
      saldoPorProducto.set(
        pid,
        Math.max(0, (saldoPorProducto.get(pid) ?? 0) - Number(s.cantidad)),
      );
    }

    const movimientosConSaldo = movimientos.map((m) => {
      const saldoAnterior = saldoPorProducto.get(m.productoId) ?? 0;
      const nuevoSaldo =
        m.tipo === 'ENTRADA'
          ? saldoAnterior + m.cantidad
          : Math.max(0, saldoAnterior - m.cantidad);
      saldoPorProducto.set(m.productoId, nuevoSaldo);
      return { ...m, saldo: nuevoSaldo };
    });

    // Productos controlados para el filtro
    const productosControlados = await this.prisma.producto.findMany({
      where: productoWhere,
      select: { id: true, descripcion: true, concentracion: true },
      orderBy: { descripcion: 'asc' },
    });

    return { movimientos: movimientosConSaldo, productosControlados };
  }

  /**
   * KPIs farmacéuticos para el dashboard de kardex.
   * Retorna null si la empresa no tiene rubro farmacéutico.
   */
  async obtenerDashboardFarmacia(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { rubro: { select: { nombre: true } } },
    });

    const rubroNombre = empresa?.rubro?.nombre?.toLowerCase() ?? '';
    const esFarmaceutico =
      rubroNombre.includes('farmacia') ||
      rubroNombre.includes('botica') ||
      rubroNombre.includes('medicament') ||
      rubroNombre.includes('drogueria') ||
      rubroNombre.includes('droguería');

    if (!esFarmaceutico) return null;

    const hoy = new Date();
    const en30dias = new Date(hoy.getTime() + 30 * 24 * 60 * 60 * 1000);

    const baseWhere = {
      producto: { empresaId },
      activo: true,
      stockActual: { gt: 0 },
    };

    const [vencidosRaw, porVencer30dRaw, top5PorVencer, top5Vencidos] =
      await Promise.all([
        this.prisma.productoLote.findMany({
          where: { ...baseWhere, fechaVencimiento: { lt: hoy } },
          select: { stockActual: true, costoUnitario: true },
        }),
        this.prisma.productoLote.count({
          where: {
            ...baseWhere,
            fechaVencimiento: { gte: hoy, lte: en30dias },
          },
        }),
        this.prisma.productoLote.findMany({
          where: {
            ...baseWhere,
            fechaVencimiento: { gte: hoy, lte: en30dias },
          },
          orderBy: { fechaVencimiento: 'asc' },
          take: 5,
          select: {
            id: true,
            lote: true,
            fechaVencimiento: true,
            stockActual: true,
            producto: { select: { descripcion: true, codigo: true } },
          },
        }),
        this.prisma.productoLote.findMany({
          where: { ...baseWhere, fechaVencimiento: { lt: hoy } },
          orderBy: { fechaVencimiento: 'asc' },
          take: 5,
          select: {
            id: true,
            lote: true,
            fechaVencimiento: true,
            stockActual: true,
            producto: { select: { descripcion: true, codigo: true } },
          },
        }),
      ]);

    const valorLotesVencidos = vencidosRaw.reduce(
      (acc, l) => acc + num(l.stockActual) * Number(l.costoUnitario ?? 0),
      0,
    );

    const mapLote = (l: any) => ({
      id: l.id,
      lote: l.lote,
      fechaVencimiento: l.fechaVencimiento,
      diasAlVencimiento: Math.floor(
        (new Date(l.fechaVencimiento).getTime() - hoy.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
      stockActual: l.stockActual,
      producto: l.producto,
    });

    return {
      lotesVencidos: vencidosRaw.length,
      lotesPorVencer30d: porVencer30dRaw,
      valorLotesVencidos,
      top5PorVencer: top5PorVencer.map(mapLote),
      top5Vencidos: top5Vencidos.map(mapLote),
    };
  }

  async obtenerSeriesGarantias(
    empresaId: number,
    filtros: {
      page?: string | number;
      limit?: string | number;
      search?: string;
      estado?: string;
      garantia?: string;
      sedeId?: number;
    },
  ) {
    const page = Math.max(Number(filtros.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(filtros.limit ?? 20), 1), 100);
    const skip = (page - 1) * limit;
    const hoy = new Date();
    const search = String(filtros.search ?? '').trim();
    const estado = String(filtros.estado ?? '')
      .trim()
      .toUpperCase();
    const garantia = String(filtros.garantia ?? '')
      .trim()
      .toUpperCase();

    const where: any = { empresaId };

    if (filtros.sedeId) where.sedeId = filtros.sedeId;
    if (estado && estado !== 'TODOS') where.estado = estado;

    if (garantia === 'VIGENTE') where.garantiaHasta = { gte: hoy };
    if (garantia === 'VENCIDA') where.garantiaHasta = { lt: hoy };
    if (garantia === 'SIN_GARANTIA') where.garantiaHasta = null;

    if (search) {
      where.OR = [
        { numeroSerie: { contains: search, mode: 'insensitive' } },
        {
          producto: { descripcion: { contains: search, mode: 'insensitive' } },
        },
        { producto: { codigo: { contains: search, mode: 'insensitive' } } },
        { comprobante: { serie: { contains: search, mode: 'insensitive' } } },
        {
          comprobante: {
            cliente: { nombre: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          comprobante: {
            cliente: { nroDoc: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [total, rows, resumenRaw] = await Promise.all([
      this.prisma.productoSerie.count({ where }),
      this.prisma.productoSerie.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ garantiaHasta: 'asc' }, { actualizadoEn: 'desc' }],
        include: {
          producto: {
            select: {
              id: true,
              codigo: true,
              descripcion: true,
              marca: { select: { nombre: true } },
            },
          },
          sede: { select: { id: true, nombre: true } },
          comprobante: {
            select: {
              id: true,
              tipoDoc: true,
              serie: true,
              correlativo: true,
              fechaEmision: true,
              cliente: {
                select: {
                  id: true,
                  nombre: true,
                  nroDoc: true,
                  telefono: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.productoSerie.findMany({
        where: {
          empresaId,
          ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
        },
        select: { estado: true, garantiaHasta: true },
      }),
    ]);

    const obtenerEstadoGarantia = (garantiaHasta: Date | null) => {
      if (!garantiaHasta) return 'SIN_GARANTIA';
      return garantiaHasta.getTime() >= hoy.getTime() ? 'VIGENTE' : 'VENCIDA';
    };

    const resumen = resumenRaw.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.estados[item.estado] = (acc.estados[item.estado] ?? 0) + 1;
        const estadoGarantia = obtenerEstadoGarantia(item.garantiaHasta);
        acc.garantias[estadoGarantia] =
          (acc.garantias[estadoGarantia] ?? 0) + 1;
        return acc;
      },
      {
        total: 0,
        estados: { DISPONIBLE: 0, VENDIDO: 0, RESERVADO: 0, BAJA: 0 } as Record<
          string,
          number
        >,
        garantias: { VIGENTE: 0, VENCIDA: 0, SIN_GARANTIA: 0 } as Record<
          string,
          number
        >,
      },
    );

    return {
      data: rows.map((serie) => ({
        id: serie.id,
        numeroSerie: serie.numeroSerie,
        estado: serie.estado,
        garantiaMeses: serie.garantiaMeses,
        garantiaHasta: serie.garantiaHasta,
        estadoGarantia: obtenerEstadoGarantia(serie.garantiaHasta),
        observacion: serie.observacion,
        creadoEn: serie.creadoEn,
        actualizadoEn: serie.actualizadoEn,
        producto: serie.producto,
        sede: serie.sede,
        comprobante: serie.comprobante
          ? {
              ...serie.comprobante,
              numero: `${serie.comprobante.serie}-${serie.comprobante.correlativo}`,
            }
          : null,
      })),
      resumen,
      paginacion: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async crearSerie(empresaId: number, sedeId: number | null, dto: any) {
    const {
      productoId,
      numeroSerie,
      garantiaMeses,
      observacion,
      compraId,
      compraDetalleId,
      estado,
    } = dto;
    if (!productoId || !numeroSerie) {
      throw new BadRequestException('productoId y numeroSerie son requeridos');
    }

    const parsedProductoId = Number(productoId);
    if (!Number.isInteger(parsedProductoId))
      throw new BadRequestException('productoId inválido');
    const serieNormalizada = this.normalizarSerie(numeroSerie);
    const estadoNormalizado = this.validarEstadoSerie(estado) ?? 'DISPONIBLE';
    const garantiaHasta = this.calcularGarantiaHasta(garantiaMeses);
    const parsedCompraId = compraId ? Number(compraId) : null;
    const parsedCompraDetalleId = compraDetalleId
      ? Number(compraDetalleId)
      : null;

    await this.validarProductoEmpresa(empresaId, parsedProductoId);
    await this.validarCompraEmpresa(
      empresaId,
      parsedCompraId,
      parsedCompraDetalleId,
    );

    const existing = await this.prisma.productoSerie.findUnique({
      where: {
        empresaId_numeroSerie: { empresaId, numeroSerie: serieNormalizada },
      },
    });
    if (existing)
      throw new BadRequestException(
        `La serie "${numeroSerie}" ya existe para esta empresa`,
      );

    const serie = await this.prisma.productoSerie.create({
      data: {
        empresaId,
        productoId: parsedProductoId,
        sedeId: sedeId ?? null,
        numeroSerie: serieNormalizada,
        estado: estadoNormalizado as any,
        garantiaMeses: garantiaMeses ? Number(garantiaMeses) : null,
        garantiaHasta,
        compraId: parsedCompraId,
        compraDetalleId: parsedCompraDetalleId,
        observacion: observacion ?? null,
      },
      include: {
        producto: { select: { id: true, codigo: true, descripcion: true } },
        sede: { select: { id: true, nombre: true } },
      },
    });
    return serie;
  }

  async actualizarSerie(empresaId: number, id: number, dto: any) {
    const serie = await this.prisma.productoSerie.findFirst({
      where: { id, empresaId },
    });
    if (!serie) throw new BadRequestException('Serie no encontrada');

    const { estado, observacion, garantiaMeses } = dto;
    const estadoNormalizado = this.validarEstadoSerie(estado);
    const garantiaHasta =
      garantiaMeses != null
        ? this.calcularGarantiaHasta(garantiaMeses)
        : serie.garantiaHasta;

    return this.prisma.productoSerie.update({
      where: { id },
      data: {
        ...(estadoNormalizado ? { estado: estadoNormalizado as any } : {}),
        ...(observacion !== undefined ? { observacion } : {}),
        ...(garantiaMeses != null
          ? { garantiaMeses: Number(garantiaMeses), garantiaHasta }
          : {}),
      },
      include: {
        producto: { select: { id: true, codigo: true, descripcion: true } },
        sede: { select: { id: true, nombre: true } },
      },
    });
  }

  async eliminarSerie(empresaId: number, id: number) {
    const serie = await this.prisma.productoSerie.findFirst({
      where: { id, empresaId },
    });
    if (!serie) throw new BadRequestException('Serie no encontrada');
    if (serie.estado === 'VENDIDO') {
      return this.prisma.productoSerie.update({
        where: { id },
        data: { estado: 'BAJA' },
      });
    }
    await this.prisma.reclamoGarantia.deleteMany({
      where: { productoSerieId: id },
    });
    await this.prisma.productoSerie.delete({ where: { id } });
    return { message: 'Serie eliminada' };
  }

  async obtenerSeriesPorProducto(
    empresaId: number,
    productoId: number,
    estado?: string,
  ) {
    await this.validarProductoEmpresa(empresaId, productoId);
    const where: any = { empresaId, productoId };
    if (estado && estado !== 'TODOS')
      where.estado = this.validarEstadoSerie(estado);
    const series = await this.prisma.productoSerie.findMany({
      where,
      orderBy: [{ estado: 'asc' }, { creadoEn: 'desc' }],
      include: {
        sede: { select: { id: true, nombre: true } },
        comprobante: {
          select: {
            serie: true,
            correlativo: true,
            fechaEmision: true,
            cliente: { select: { nombre: true, nroDoc: true } },
          },
        },
        compra: {
          select: { id: true, serie: true, numero: true, fechaEmision: true },
        },
        reclamos: {
          select: {
            id: true,
            estadoReclamo: true,
            descripcion: true,
            fechaReclamo: true,
          },
        },
      },
    });

    const hoy = new Date();
    return series.map((s) => ({
      ...s,
      estadoGarantia: !s.garantiaHasta
        ? 'SIN_GARANTIA'
        : s.garantiaHasta >= hoy
          ? 'VIGENTE'
          : 'VENCIDA',
      comprobante: s.comprobante
        ? {
            ...s.comprobante,
            numero: `${s.comprobante.serie}-${s.comprobante.correlativo}`,
          }
        : null,
    }));
  }

  async crearReclamo(empresaId: number, serieId: number, dto: any) {
    const serie = await this.prisma.productoSerie.findFirst({
      where: { id: serieId, empresaId },
    });
    if (!serie) throw new BadRequestException('Serie no encontrada');
    const { descripcion, tecnico, estadoReclamo } = dto;
    if (!descripcion) throw new BadRequestException('descripcion es requerida');
    const estadoReclamoNormalizado =
      this.validarEstadoReclamo(estadoReclamo) ?? 'ABIERTO';
    return this.prisma.reclamoGarantia.create({
      data: {
        empresaId,
        productoSerieId: serieId,
        descripcion: String(descripcion),
        tecnico: tecnico ?? null,
        estadoReclamo: estadoReclamoNormalizado as any,
      },
    });
  }

  async obtenerReclamos(empresaId: number, serieId: number) {
    const serie = await this.prisma.productoSerie.findFirst({
      where: { id: serieId, empresaId },
    });
    if (!serie) throw new BadRequestException('Serie no encontrada');
    return this.prisma.reclamoGarantia.findMany({
      where: { productoSerieId: serieId },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async actualizarReclamo(empresaId: number, reclamoId: number, dto: any) {
    const reclamo = await this.prisma.reclamoGarantia.findFirst({
      where: { id: reclamoId, empresaId },
    });
    if (!reclamo) throw new BadRequestException('Reclamo no encontrado');
    const { estadoReclamo, resolucion, tecnico, fechaResolucion } = dto;
    const estadoReclamoNormalizado = this.validarEstadoReclamo(estadoReclamo);
    return this.prisma.reclamoGarantia.update({
      where: { id: reclamoId },
      data: {
        ...(estadoReclamoNormalizado
          ? { estadoReclamo: estadoReclamoNormalizado as any }
          : {}),
        ...(resolucion !== undefined ? { resolucion } : {}),
        ...(tecnico !== undefined ? { tecnico } : {}),
        ...(fechaResolucion
          ? { fechaResolucion: new Date(fechaResolucion) }
          : {}),
        ...(estadoReclamoNormalizado &&
        ['RESUELTO', 'CERRADO'].includes(estadoReclamoNormalizado) &&
        !reclamo.fechaResolucion
          ? { fechaResolucion: new Date() }
          : {}),
      },
    });
  }

  async eliminarReclamo(empresaId: number, reclamoId: number) {
    const reclamo = await this.prisma.reclamoGarantia.findFirst({
      where: { id: reclamoId, empresaId },
    });
    if (!reclamo) throw new BadRequestException('Reclamo no encontrado');
    await this.prisma.reclamoGarantia.delete({ where: { id: reclamoId } });
    return { message: 'Reclamo eliminado' };
  }

  private readonly logger = new Logger('KardexService');

  private fetchUrlAsBase64(url: string): Promise<string> {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      client
        .get(url, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const mime = res.headers['content-type'] || 'image/png';
            const b64 = Buffer.concat(chunks).toString('base64');
            resolve(`data:${mime};base64,${b64}`);
          });
          res.on('error', () => resolve(''));
        })
        .on('error', () => resolve(''));
    });
  }

  async generarConstanciaGarantia(empresaId: number, serieId: number) {
    const serie = await this.prisma.productoSerie.findFirst({
      where: { id: serieId, empresaId },
      include: {
        empresa: {
          select: {
            razonSocial: true,
            nombreComercial: true,
            ruc: true,
            direccion: true,
            logo: true,
            whatsappTienda: true,
          },
        },
        producto: {
          select: {
            codigo: true,
            descripcion: true,
            atributosTecnicos: true,
            marca: { select: { nombre: true } },
          },
        },
        sede: { select: { nombre: true } },
        comprobante: {
          select: {
            serie: true,
            correlativo: true,
            fechaEmision: true,
            cliente: {
              select: {
                nombre: true,
                nroDoc: true,
                telefono: true,
                email: true,
              },
            },
          },
        },
        compra: { select: { serie: true, numero: true, fechaEmision: true } },
      },
    });

    if (!serie) throw new BadRequestException('Serie no encontrada');

    const atributos = (serie.producto.atributosTecnicos ?? {}) as Record<
      string,
      any
    >;
    const comprobanteNumero = serie.comprobante
      ? `${serie.comprobante.serie}-${String(serie.comprobante.correlativo).padStart(8, '0')}`
      : null;
    const compraNumero = serie.compra
      ? [serie.compra.serie, serie.compra.numero].filter(Boolean).join('-')
      : null;

    // Convertir logo a base64 para que Puppeteer lo renderice sin depender de URLs externas
    let logoBase64: string | null = null;
    if (serie.empresa.logo) {
      try {
        logoBase64 = await this.fetchUrlAsBase64(serie.empresa.logo);
      } catch {
        this.logger.warn(
          'No se pudo convertir el logo a base64; se omitirá en la constancia',
        );
      }
    }

    const buffer = await this.pdfGenerator.generarPDFConstanciaGarantia({
      empresa: {
        razonSocial: serie.empresa.razonSocial,
        nombreComercial: serie.empresa.nombreComercial,
        ruc: serie.empresa.ruc,
        direccion: serie.empresa.direccion,
        logo: logoBase64 || serie.empresa.logo,
        telefono: serie.empresa.whatsappTienda,
      },
      producto: {
        codigo: serie.producto.codigo,
        descripcion: serie.producto.descripcion,
        marca: serie.producto.marca?.nombre,
        modelo: atributos.modelo,
        partNumber: atributos.partNumber,
      },
      serie: {
        id: serie.id,
        numeroSerie: serie.numeroSerie,
        estado: serie.estado,
        garantiaMeses: serie.garantiaMeses,
        garantiaHasta: serie.garantiaHasta,
        observacion: serie.observacion,
        sede: serie.sede?.nombre,
      },
      cliente: serie.comprobante?.cliente ?? null,
      comprobante: {
        numero: comprobanteNumero,
        fechaEmision: serie.comprobante?.fechaEmision,
      },
      compra: {
        numero: compraNumero,
        fechaEmision: serie.compra?.fechaEmision,
      },
    });

    return {
      buffer,
      filename: `constancia-garantia-${serie.numeroSerie}.pdf`.replace(
        /[^\w.-]+/g,
        '_',
      ),
    };
  }
}
