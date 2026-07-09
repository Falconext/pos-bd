import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { num, round3 } from '../common/utils/stock';

@Injectable()
export class ProductoLoteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtener lotes disponibles de un producto (ordenados por vencimiento FEFO)
   * FEFO = First Expire, First Out
   */
  async obtenerLotesDisponibles(productoId: number, empresaId: number) {
    // Verificar que el producto pertenece a la empresa
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    return this.prisma.productoLote.findMany({
      where: {
        productoId,
        activo: true,
        stockActual: { gt: 0 },
      },
      orderBy: { fechaVencimiento: 'asc' }, // FEFO
      include: {
        producto: {
          select: {
            descripcion: true,
            codigo: true,
          },
        },
      },
    });
  }

  /**
   * Crear nuevo lote al ingresar mercadería
   */
  async crearLote(data: {
    productoId: number;
    empresaId: number;
    lote: string;
    fechaVencimiento: Date;
    stockInicial: number;
    usuarioId: number;
    costoUnitario?: number;
    proveedor?: string;
  }) {
    // Verificar que el producto pertenece a la empresa
    const producto = await this.prisma.producto.findFirst({
      where: { id: data.productoId, empresaId: data.empresaId },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Verificar duplicados
    const loteExistente = await this.prisma.productoLote.findUnique({
      where: {
        productoId_lote: {
          productoId: data.productoId,
          lote: data.lote,
        },
      },
    });

    if (loteExistente) {
      throw new BadRequestException(
        `Ya existe un lote con código "${data.lote}" para este producto`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Validar y actualizar Stock Global del Producto
      const productoActualizado = await tx.producto.update({
        where: { id: data.productoId },
        data: { stock: { increment: data.stockInicial } },
      });

      // 2. Crear Lote
      const nuevoLote = await tx.productoLote.create({
        data: {
          productoId: data.productoId,
          lote: data.lote,
          fechaVencimiento: data.fechaVencimiento,
          stockInicial: data.stockInicial,
          stockActual: data.stockInicial,
          costoUnitario: data.costoUnitario,
          proveedor: data.proveedor,
          activo: true,
        },
        include: {
          producto: true,
        },
      });

      // 3. Registrar Movimiento Global (Kardex)
      const movimiento = await tx.movimientoKardex.create({
        data: {
          productoId: data.productoId,
          empresaId: data.empresaId,
          tipoMovimiento: 'INGRESO',
          concepto: `Apertura Lote: ${data.lote}`,
          cantidad: data.stockInicial,
          stockAnterior: round3(
            num(productoActualizado.stock) - num(data.stockInicial),
          ),
          stockActual: num(productoActualizado.stock),
          costoUnitario: data.costoUnitario || producto.costoPromedio || 0,
          usuarioId: data.usuarioId,
          comprobanteId: null,
          fecha: new Date(),
        },
      });

      // 4. Registrar Movimiento Específico de Lote
      await tx.movimientoKardexLote.create({
        data: {
          movimientoId: movimiento.id,
          productoLoteId: nuevoLote.id,
          cantidad: data.stockInicial,
          stockAnterior: 0,
          stockActual: data.stockInicial,
        },
      });

      return nuevoLote;
    });
  }

  /**
   * Crea o actualiza un ProductoLote desde un ingreso de compra.
   * NO modifica Producto.stock (ya fue hecho por KardexService.registrarMovimiento).
   * Si factorConversion > 1, el stock se almacena en unidadVenta (unidad mínima).
   */
  async sincronizarLoteDesdeIngreso(params: {
    productoId: number;
    empresaId: number;
    lote: string;
    fechaVencimiento: Date;
    cantidad: number; // en unidadCompra
    costoUnitario?: number;
    movimientoKardexId: number;
  }): Promise<void> {
    const producto = await this.prisma.producto.findFirst({
      where: { id: params.productoId, empresaId: params.empresaId },
      select: { factorConversion: true },
    });

    const factor = Number(producto?.factorConversion ?? 1);
    const stockEnUnidad = params.cantidad * factor;

    const loteExistente = await this.prisma.productoLote.findUnique({
      where: {
        productoId_lote: { productoId: params.productoId, lote: params.lote },
      },
    });

    if (loteExistente) {
      await this.prisma.productoLote.update({
        where: { id: loteExistente.id },
        data: { stockActual: { increment: stockEnUnidad }, activo: true },
      });
      await this.prisma.movimientoKardexLote.create({
        data: {
          productoLoteId: loteExistente.id,
          movimientoId: params.movimientoKardexId,
          cantidad: stockEnUnidad,
          stockAnterior: num(loteExistente.stockActual),
          stockActual: round3(
            num(loteExistente.stockActual) + num(stockEnUnidad),
          ),
        },
      });
    } else {
      const nuevoLote = await this.prisma.productoLote.create({
        data: {
          productoId: params.productoId,
          lote: params.lote,
          fechaVencimiento: params.fechaVencimiento,
          stockInicial: stockEnUnidad,
          stockActual: stockEnUnidad,
          costoUnitario: params.costoUnitario,
          activo: true,
        },
      });
      await this.prisma.movimientoKardexLote.create({
        data: {
          productoLoteId: nuevoLote.id,
          movimientoId: params.movimientoKardexId,
          cantidad: stockEnUnidad,
          stockAnterior: 0,
          stockActual: stockEnUnidad,
        },
      });
    }
  }

  /**
   * Descuento atómico de un lote específico dentro de una transacción Prisma existente.
   * Usa conditional UPDATE para evitar sobreventa por concurrencia.
   * Llamar siempre desde dentro de prisma.$transaction().
   */
  async descontarStockLoteEnTx(
    tx: Prisma.TransactionClient,
    params: { loteId: number; cantidad: number; movimientoKardexId: number },
  ): Promise<void> {
    const { loteId, cantidad, movimientoKardexId } = params;

    // Leer estado actual dentro de la tx para registrar stockAnterior
    const lote = await tx.productoLote.findUnique({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote ${loteId} no encontrado`);
    if (!lote.activo)
      throw new BadRequestException(`El lote ${lote.lote} está inactivo`);

    // Validar vencimiento (no dispensar lotes vencidos)
    if (lote.fechaVencimiento && lote.fechaVencimiento < new Date()) {
      throw new BadRequestException(
        `El lote ${lote.lote} está vencido (${lote.fechaVencimiento.toISOString().slice(0, 10)})`,
      );
    }

    // UPDATE condicional atómico — si otra tx decrementó justo antes, count=0 y lanzamos error
    const result = await tx.productoLote.updateMany({
      where: {
        id: loteId,
        activo: true,
        stockActual: { gte: cantidad },
      },
      data: {
        stockActual: { decrement: cantidad },
        ...(num(lote.stockActual) - cantidad <= 0 ? { activo: false } : {}),
      },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        `Stock insuficiente en lote ${lote.lote}. Disponible: ${lote.stockActual}, solicitado: ${cantidad}`,
      );
    }

    await tx.movimientoKardexLote.create({
      data: {
        productoLoteId: loteId,
        movimientoId: movimientoKardexId,
        cantidad,
        stockAnterior: num(lote.stockActual),
        stockActual: round3(num(lote.stockActual) - cantidad),
      },
    });
  }

  /**
   * Descontar stock de un lote específico (para ventas)
   * Automáticamente elige el lote más próximo a vencer si no se especifica
   */
  async descontarStockLote(
    productoId: number,
    cantidad: number,
    movimientoKardexId: number,
    loteId?: number, // Opcional: si no se proporciona, usa FEFO
  ) {
    let cantidadRestante = cantidad;
    const lotesAfectados: any[] = [];

    if (loteId) {
      // Caso 1: Lote específico proporcionado (ej. venta manual seleccionando lote)
      const lote = await this.prisma.productoLote.findUnique({
        where: { id: loteId },
      });

      if (!lote) throw new NotFoundException('Lote no encontrado');
      if (num(lote.stockActual) < cantidad) {
        throw new BadRequestException(
          `Stock insuficiente en el lote "${lote.lote}". Disponible: ${lote.stockActual}`,
        );
      }

      lotesAfectados.push({ lote, cantidadAdescontar: cantidad });
    } else {
      // Caso 2: FEFO automático (múltiples lotes si es necesario)
      // Solo lotes vigentes (no vencidos) — los vencidos deben darse de baja manualmente
      const lotesDisponibles = await this.prisma.productoLote.findMany({
        where: {
          productoId,
          activo: true,
          stockActual: { gt: 0 },
          fechaVencimiento: { gte: new Date() },
        },
        orderBy: { fechaVencimiento: 'asc' }, // Primero los próximos a vencer (FEFO)
      });

      if (lotesDisponibles.length === 0) {
        // Si no hay lotes, no hacemos nada (quizás no es producto con lotes o es venta sin stock)
        // O lanzamos error? Depende de la regla de negocio.
        // Para evitar bloquear ventas de productos sin lotes configurados, retornamos null o array vacío.
        // Pero si es farmacia, DEBERÍA tener lotes.
        // Asumiremos que si se llama a este método, SE ESPERA que haya lotes.
        // Pero permitamos fallo "suave" si no hay lotes, para no romper ventas antiguas.
        // Mejor: Si no encuentra lotes, no descuenta de lotes (solo stock global ya descontado).
        return [];
      }

      // Verificar stock total disponible en lotes
      const stockTotalLotes = lotesDisponibles.reduce(
        (acc, l) => acc + num(l.stockActual),
        0,
      );
      if (stockTotalLotes < cantidad) {
        // Opción: Bloquear venta o permitir stock negativo global (pero lotes en 0).
        // Regla Farmacia: No vender sin lote.
        throw new BadRequestException(
          `Stock insuficiente en lotes. Solicitado: ${cantidad}, Disponible en lotes: ${stockTotalLotes}`,
        );
      }

      // Distribuir descuento
      for (const lote of lotesDisponibles) {
        if (cantidadRestante <= 0) break;

        const descuento = Math.min(num(lote.stockActual), cantidadRestante);
        lotesAfectados.push({ lote, cantidadAdescontar: descuento });
        cantidadRestante -= descuento;
      }
    }

    // Ejecutar transacciones
    const transacciones: any[] = [];
    for (const item of lotesAfectados) {
      // Actualizar Lote
      transacciones.push(
        this.prisma.productoLote.update({
          where: { id: item.lote.id },
          data: { stockActual: { decrement: item.cantidadAdescontar } },
        }),
      );

      // Registrar Movimiento Lote
      transacciones.push(
        this.prisma.movimientoKardexLote.create({
          data: {
            productoLoteId: item.lote.id,
            movimientoId: movimientoKardexId,
            cantidad: item.cantidadAdescontar,
            stockAnterior: item.lote.stockActual,
            stockActual: item.lote.stockActual - item.cantidadAdescontar,
          },
        }),
      );
    }

    await this.prisma.$transaction(transacciones);

    return lotesAfectados;
  }

  /**
   * Aumentar stock de un lote (para devoluciones o ajustes)
   */
  async aumentarStockLote(
    loteId: number,
    cantidad: number,
    movimientoKardexId: number,
  ) {
    const lote = await this.prisma.productoLote.findUnique({
      where: { id: loteId },
    });

    if (!lote) {
      throw new NotFoundException('Lote no encontrado');
    }

    await this.prisma.$transaction([
      this.prisma.productoLote.update({
        where: { id: loteId },
        data: { stockActual: { increment: cantidad } },
      }),

      this.prisma.movimientoKardexLote.create({
        data: {
          productoLoteId: loteId,
          movimientoId: movimientoKardexId,
          cantidad,
          stockAnterior: num(lote.stockActual),
          stockActual: round3(num(lote.stockActual) + cantidad),
        },
      }),
    ]);
  }

  /**
   * Alertar productos próximos a vencer
   */
  async obtenerProductosPorVencer(empresaId: number, diasAnticipacion = 30) {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + diasAnticipacion);

    return this.prisma.productoLote.findMany({
      where: {
        producto: { empresaId },
        fechaVencimiento: { lte: fechaLimite },
        stockActual: { gt: 0 },
        activo: true,
      },
      include: {
        producto: {
          select: {
            descripcion: true,
            codigo: true,
            precioUnitario: true,
          },
        },
      },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  /**
   * Obtener lotes vencidos
   */
  async obtenerLotesVencidos(empresaId: number) {
    const hoy = new Date();

    return this.prisma.productoLote.findMany({
      where: {
        producto: { empresaId },
        fechaVencimiento: { lt: hoy },
        stockActual: { gt: 0 },
        activo: true,
      },
      include: {
        producto: true,
      },
      orderBy: { fechaVencimiento: 'desc' },
    });
  }

  /**
   * Obtener todos los lotes de un producto (con historial)
   */
  async obtenerLotesProducto(productoId: number, empresaId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    return this.prisma.productoLote.findMany({
      where: { productoId },
      include: {
        movimientosKardex: {
          include: {
            movimiento: {
              select: {
                concepto: true,
                fecha: true,
                tipoMovimiento: true,
              },
            },
          },
          orderBy: { id: 'desc' },
          take: 5, // Últimos 5 movimientos por lote
        },
      },
      orderBy: { fechaVencimiento: 'asc' },
    });
  }

  /**
   * Actualizar metadatos de un lote (código, vencimiento, costo, proveedor)
   */
  async actualizarLote(
    loteId: number,
    empresaId: number,
    data: {
      lote?: string;
      fechaVencimiento?: Date;
      costoUnitario?: number;
      proveedor?: string;
    },
  ) {
    const lote = await this.prisma.productoLote.findUnique({
      where: { id: loteId },
      include: { producto: true },
    });

    if (!lote) throw new NotFoundException('Lote no encontrado');
    if (lote.producto.empresaId !== empresaId) {
      throw new BadRequestException('No tienes permisos para este lote');
    }

    if (data.lote && data.lote !== lote.lote) {
      const existe = await this.prisma.productoLote.findFirst({
        where: {
          productoId: lote.productoId,
          lote: data.lote,
          id: { not: loteId },
        },
      });
      if (existe)
        throw new BadRequestException(
          `Ya existe un lote con código "${data.lote}" para este producto`,
        );
    }

    return this.prisma.productoLote.update({
      where: { id: loteId },
      data,
    });
  }

  /**
   * Desactivar lote (no eliminar físicamente)
   */
  async desactivarLote(loteId: number, empresaId: number, usuarioId: number) {
    const lote = await this.prisma.productoLote.findUnique({
      where: { id: loteId },
      include: { producto: true },
    });

    if (!lote) {
      throw new NotFoundException('Lote no encontrado');
    }

    if (lote.producto.empresaId !== empresaId) {
      throw new BadRequestException('No tienes permisos para este lote');
    }

    // Si ya está inactivo o sin stock, solo desactivamos sin movimiento
    if (!lote.stockActual || num(lote.stockActual) <= 0) {
      return this.prisma.productoLote.update({
        where: { id: loteId },
        data: { activo: false },
      });
    }

    // Transacción completa: Kardex, Stock Global, Stock Lote
    return this.prisma.$transaction(async (tx) => {
      // 1. Crear Movimiento Kardex Global (SALIDA)
      const movimiento = await tx.movimientoKardex.create({
        data: {
          productoId: lote.productoId,
          empresaId: empresaId,
          usuarioId: usuarioId,
          tipoMovimiento: 'SALIDA',
          concepto: `Baja por Vencimiento/Deterioro (Lote: ${lote.lote})`,
          cantidad: Number(lote.stockActual),
          stockAnterior: num(lote.producto.stock),
          stockActual: round3(
            num(lote.producto.stock) - Number(lote.stockActual),
          ),
          fecha: new Date(),
          costoUnitario: lote.costoUnitario,
        },
      });

      // 2. Crear Movimiento Kardex Lote
      await tx.movimientoKardexLote.create({
        data: {
          movimientoId: movimiento.id,
          productoLoteId: lote.id,
          cantidad: Number(lote.stockActual),
          stockAnterior: Number(lote.stockActual),
          stockActual: 0,
        },
      });

      // 3. Actualizar Stock Global del Producto
      await tx.producto.update({
        where: { id: lote.productoId },
        data: {
          stock: { decrement: Number(lote.stockActual) },
        },
      });

      // 4. Desactivar Lote y poner Stock a 0
      return tx.productoLote.update({
        where: { id: loteId },
        data: {
          activo: false,
          stockActual: 0,
        },
      });
    });
  }

  async obtenerLotesConFiltros(params: {
    empresaId: number;
    page?: number;
    limit?: number;
    search?: string;
    estado?: 'TODOS' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDO';
  }) {
    const { empresaId } = params;
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const skip = (page - 1) * limit;
    const searchTerm = params.search?.trim();
    const hoy = new Date();
    const en30dias = new Date(hoy.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Filtro de estado en fechaVencimiento
    let fechaWhere: any = undefined;
    if (params.estado === 'VIGENTE') {
      fechaWhere = { gt: en30dias };
    } else if (params.estado === 'POR_VENCER') {
      fechaWhere = { gte: hoy, lte: en30dias };
    } else if (params.estado === 'VENCIDO') {
      fechaWhere = { lt: hoy };
    }

    const where: any = {
      producto: { empresaId },
      activo: true,
      ...(fechaWhere ? { fechaVencimiento: fechaWhere } : {}),
      ...(searchTerm
        ? {
            OR: [
              { lote: { contains: searchTerm, mode: 'insensitive' } },
              {
                producto: {
                  descripcion: { contains: searchTerm, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    // KPIs globales (sin paginación)
    const [totalActivos, porVencer30d, vencidosConStock, valorAggregate] =
      await Promise.all([
        this.prisma.productoLote.count({
          where: {
            producto: { empresaId },
            activo: true,
            stockActual: { gt: 0 },
          },
        }),
        this.prisma.productoLote.count({
          where: {
            producto: { empresaId },
            activo: true,
            stockActual: { gt: 0 },
            fechaVencimiento: { gte: hoy, lte: en30dias },
          },
        }),
        this.prisma.productoLote.count({
          where: {
            producto: { empresaId },
            activo: true,
            stockActual: { gt: 0 },
            fechaVencimiento: { lt: hoy },
          },
        }),
        this.prisma.productoLote.findMany({
          where: {
            producto: { empresaId },
            activo: true,
            stockActual: { gt: 0 },
            costoUnitario: { not: null },
          },
          select: { stockActual: true, costoUnitario: true },
        }),
      ]);

    const valorTotalInventario = valorAggregate.reduce(
      (acc, l) => acc + num(l.stockActual) * Number(l.costoUnitario ?? 0),
      0,
    );

    const [lotesRaw, total] = await Promise.all([
      this.prisma.productoLote.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaVencimiento: 'asc' },
        include: {
          producto: {
            select: {
              id: true,
              descripcion: true,
              codigo: true,
              imagenUrl: true,
              categoriaId: true,
            },
          },
          detallesComprobante: { select: { id: true } },
        },
      }),
      this.prisma.productoLote.count({ where }),
    ]);

    const lotes = lotesRaw.map((l) => {
      const diasAlVencimiento = Math.floor(
        (new Date(l.fechaVencimiento).getTime() - hoy.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      return {
        id: l.id,
        lote: l.lote,
        fechaVencimiento: l.fechaVencimiento,
        stockActual: l.stockActual,
        stockInicial: l.stockInicial,
        costoUnitario: l.costoUnitario ? Number(l.costoUnitario) : null,
        proveedor: l.proveedor,
        activo: l.activo,
        creadoEn: l.creadoEn,
        diasAlVencimiento,
        valorEnStock: num(l.stockActual) * Number(l.costoUnitario ?? 0),
        totalVentas: l.detallesComprobante.length,
        producto: l.producto,
      };
    });

    return {
      kpis: {
        totalActivos,
        porVencer30d,
        vencidosConStock,
        valorTotalInventario,
      },
      lotes,
      total,
      page,
      limit,
    };
  }

  // Mantener compatibilidad con llamadas existentes
  async obtenerTodosLotes(empresaId: number) {
    const result = await this.obtenerLotesConFiltros({
      empresaId,
      limit: 1000,
    });
    return result.lotes;
  }
  /**
   * Obtener historial kardex de un lote específico
   */
  async obtenerKardexLote(loteId: number, empresaId: number) {
    const lote = await this.prisma.productoLote.findUnique({
      where: { id: loteId },
      include: { producto: true },
    });

    if (!lote) {
      throw new NotFoundException('Lote no encontrado');
    }

    if (lote.producto.empresaId !== empresaId) {
      throw new BadRequestException('No tienes permisos para ver este lote');
    }

    return this.prisma.movimientoKardexLote.findMany({
      where: { productoLoteId: loteId },
      include: {
        movimiento: {
          select: {
            fecha: true,
            concepto: true,
            tipoMovimiento: true,
            usuario: {
              select: { nombre: true }, // Opcional: ver quién hizo el movimiento
            },
          },
        },
      },
      orderBy: { id: 'desc' },
    });
  }
}
