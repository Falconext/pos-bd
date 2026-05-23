import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecetaDto } from './dto/create-receta.dto';
import { UpdateRecetaDto } from './dto/update-receta.dto';
import { CreateOrdenProduccionDto } from './dto/create-orden-produccion.dto';
import { RegistrarEjecucionOrdenDto } from './dto/registrar-ejecucion-orden.dto';
import { UpdateEstadoOrdenDto } from './dto/update-estado-orden.dto';
import { UpdateMetodoSalidaDto } from './dto/update-metodo-salida.dto';
import { Prisma } from '@prisma/client';
import { ProductoService } from '../producto/producto.service';
import { Decimal } from '@prisma/client/runtime/library';
import * as XLSX from 'xlsx';

@Injectable()
export class ProduccionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productoService: ProductoService,
  ) {}

  private validarEmpresaId(empresaId?: number) {
    if (!empresaId) {
      throw new BadRequestException(
        'No se encontró empresa activa en el token.',
      );
    }
  }

  private async validarProductoEmpresa(
    empresaId: number,
    productoId: number,
    etiqueta = 'producto',
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        costoPromedio: true,
        factorConversion: true,
      },
    });
    if (!producto) {
      throw new BadRequestException(
        `El ${etiqueta} ${productoId} no pertenece a la empresa.`,
      );
    }
    return producto;
  }

  private async obtenerRecetaEmpresa(empresaId: number, recetaId: number) {
    const receta = await this.prisma.recetaProduccion.findFirst({
      where: { id: recetaId, empresaId },
      include: {
        componentes: {
          orderBy: { orden: 'asc' },
        },
      },
    });
    if (!receta) {
      throw new NotFoundException('Receta no encontrada.');
    }
    return receta;
  }

  private esRubroFabricacion(nombreRubro?: string | null) {
    if (!nombreRubro) return false;
    const nombre = nombreRubro.toLowerCase();
    return (
      nombre.includes('fabricación') ||
      nombre.includes('fabricacion') ||
      nombre.includes('manufactura') ||
      nombre.includes('industria') ||
      nombre.includes('producción') ||
      nombre.includes('produccion')
    );
  }

  private async asegurarRubroFabricacion(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        rubro: {
          select: { nombre: true },
        },
      },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    if (!this.esRubroFabricacion(empresa.rubro?.nombre)) {
      throw new ForbiddenException(
        'El módulo de producción está habilitado solo para rubros de fabricación/manufactura.',
      );
    }
  }

  private async resolverSedeIdProduccion(empresaId: number, sedeId?: number) {
    if (sedeId) {
      const sede = await this.prisma.sede.findFirst({
        where: { id: sedeId, empresaId, activo: true },
        select: { id: true },
      });
      if (sede) return sede.id;
    }

    const principal = await this.prisma.sede.findFirst({
      where: { empresaId, esPrincipal: true, activo: true },
      select: { id: true },
    });

    if (!principal) {
      throw new BadRequestException(
        'No se encontró sede activa para registrar movimientos de producción.',
      );
    }

    return principal.id;
  }

  private convertirAUnidadesStock(
    cantidad: number,
    factorConversion: number,
    contexto: string,
  ) {
    if (!Number.isFinite(cantidad) || cantidad < 0) {
      throw new BadRequestException(`Cantidad inválida para ${contexto}.`);
    }
    if (!Number.isFinite(factorConversion) || factorConversion <= 0) {
      throw new BadRequestException(
        `Factor de conversión inválido en ${contexto}. Configura factorConversion del producto.`,
      );
    }

    const valorEscalado = cantidad * factorConversion;
    const unidades = Math.round(valorEscalado);
    const diferencia = Math.abs(valorEscalado - unidades);
    if (diferencia > 0.000001) {
      throw new BadRequestException(
        `La cantidad ${cantidad} no se puede convertir de forma exacta a stock entero para ${contexto}. Ajusta factorConversion.`,
      );
    }

    return unidades;
  }

  private normalizarMetodoSalidaLotes(
    value?: string | null,
  ): 'FEFO' | 'FIFO' | 'LIFO' {
    const raw = String(value ?? '')
      .trim()
      .toUpperCase();
    if (raw === 'FEFO' || raw === 'FIFO' || raw === 'LIFO') return raw;
    return 'LIFO';
  }

  private async obtenerMetodoSalidaLotes(
    empresaId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<'FEFO' | 'FIFO' | 'LIFO'> {
    const db = tx ?? this.prisma;
    const empresa = await db.empresa.findUnique({
      where: { id: empresaId },
      select: { metodoSalidaLotes: true },
    });
    if (empresa?.metodoSalidaLotes) {
      return this.normalizarMetodoSalidaLotes(empresa.metodoSalidaLotes);
    }
    return this.normalizarMetodoSalidaLotes(
      process.env.PRODUCCION_LOTES_SALIDA ?? 'LIFO',
    );
  }

  private async distribuirSalidaEnLotesEnTx(
    tx: Prisma.TransactionClient,
    productoId: number,
    cantidad: number,
    metodoSalida: 'FEFO' | 'FIFO' | 'LIFO',
  ) {
    if (cantidad <= 0) return [];

    let orderBy: Prisma.ProductoLoteOrderByWithRelationInput[] = [];
    if (metodoSalida === 'FEFO') {
      orderBy = [{ fechaVencimiento: 'asc' }, { fechaIngreso: 'asc' }];
    } else if (metodoSalida === 'FIFO') {
      orderBy = [{ fechaIngreso: 'asc' }];
    } else {
      orderBy = [{ fechaIngreso: 'desc' }];
    }

    const lotesDisponibles = await tx.productoLote.findMany({
      where: {
        productoId,
        activo: true,
        stockActual: { gt: 0 },
      },
      orderBy,
      select: {
        id: true,
        lote: true,
        stockActual: true,
      },
    });

    if (!lotesDisponibles.length) {
      return [];
    }

    const stockTotalLotes = lotesDisponibles.reduce(
      (acc, item) => acc + Number(item.stockActual),
      0,
    );
    if (stockTotalLotes < cantidad) {
      const producto = await tx.producto.findUnique({
        where: { id: productoId },
        select: { codigo: true, descripcion: true },
      });
      const etiquetaProducto = producto
        ? `${producto.codigo} - ${producto.descripcion}`
        : `ID ${productoId}`;
      throw new BadRequestException(
        `Stock insuficiente en lotes para ${etiquetaProducto}. Solicitado: ${cantidad}, Disponible en lotes: ${stockTotalLotes}.`,
      );
    }

    let restante = cantidad;
    const distribucion: Array<{
      loteId: number;
      lote: string;
      cantidad: number;
      stockAnterior: number;
      stockActual: number;
    }> = [];

    for (const lote of lotesDisponibles) {
      if (restante <= 0) break;
      const stockActual = Number(lote.stockActual);
      const cantidadUsada = Math.min(stockActual, restante);
      distribucion.push({
        loteId: lote.id,
        lote: lote.lote,
        cantidad: cantidadUsada,
        stockAnterior: stockActual,
        stockActual: stockActual - cantidadUsada,
      });
      restante -= cantidadUsada;
    }

    return distribucion;
  }

  private async registrarMovimientoKardexEnTx(
    tx: Prisma.TransactionClient,
    data: {
      productoId: number;
      empresaId: number;
      sedeId: number;
      usuarioId: number;
      tipoMovimiento: 'INGRESO' | 'SALIDA';
      concepto: string;
      cantidad: number;
      costoUnitario?: number;
      observacion?: string;
      fecha?: Date;
    },
  ) {
    if (data.cantidad <= 0) return null;

    let productoStock = await tx.productoStock.findUnique({
      where: {
        productoId_sedeId: {
          productoId: data.productoId,
          sedeId: data.sedeId,
        },
      },
      include: {
        producto: {
          select: {
            costoPromedio: true,
          },
        },
      },
    });

    if (!productoStock) {
      const productoBase = await tx.producto.findUnique({
        where: { id: data.productoId },
        select: { stock: true, costoPromedio: true },
      });

      await tx.productoStock.create({
        data: {
          productoId: data.productoId,
          sedeId: data.sedeId,
          stock: productoBase?.stock ?? 0,
          stockMinimo: 0,
        },
      });

      productoStock = await tx.productoStock.findUnique({
        where: {
          productoId_sedeId: {
            productoId: data.productoId,
            sedeId: data.sedeId,
          },
        },
        include: {
          producto: {
            select: {
              costoPromedio: true,
            },
          },
        },
      });
    }

    if (!productoStock) {
      throw new NotFoundException(
        'No se pudo inicializar el stock del producto para producción.',
      );
    }

    const stockAnterior = productoStock.stock;
    let stockActual = stockAnterior;
    if (data.tipoMovimiento === 'INGRESO') {
      stockActual += data.cantidad;
    } else {
      stockActual -= data.cantidad;
    }

    if (stockActual < 0) {
      const producto = await tx.producto.findUnique({
        where: { id: data.productoId },
        select: { codigo: true, descripcion: true },
      });
      const etiquetaProducto = producto
        ? `${producto.codigo} - ${producto.descripcion}`
        : `ID ${data.productoId}`;
      throw new BadRequestException(
        `Stock insuficiente para ${data.concepto}. Producto: ${etiquetaProducto}.`,
      );
    }

    const costoUnitario =
      data.costoUnitario ?? Number(productoStock.producto.costoPromedio) ?? 0;
    const valorTotal = costoUnitario * data.cantidad;

    const movimiento = await tx.movimientoKardex.create({
      data: {
        productoId: data.productoId,
        empresaId: data.empresaId,
        tipoMovimiento: data.tipoMovimiento,
        concepto: data.concepto,
        cantidad: data.cantidad,
        stockAnterior,
        stockActual,
        costoUnitario,
        valorTotal,
        fecha: data.fecha ?? new Date(),
        usuarioId: data.usuarioId,
        observacion: data.observacion,
        sedeId: data.sedeId,
      },
    });

    await tx.productoStock.update({
      where: {
        productoId_sedeId: {
          productoId: data.productoId,
          sedeId: data.sedeId,
        },
      },
      data: {
        stock: stockActual,
      },
    });

    const totalStock = await tx.productoStock.aggregate({
      where: { productoId: data.productoId },
      _sum: { stock: true },
    });

    await tx.producto.update({
      where: { id: data.productoId },
      data: {
        stock: totalStock._sum.stock ?? 0,
      },
    });

    if (data.tipoMovimiento === 'INGRESO' && data.costoUnitario !== undefined) {
      const producto = await tx.producto.findUnique({
        where: { id: data.productoId },
        select: { costoPromedio: true },
      });

      const stockActualGlobal = totalStock._sum.stock ?? 0;
      const stockAnteriorGlobal = stockActualGlobal - data.cantidad;
      const costoAnterior = Number(producto?.costoPromedio ?? 0);
      const valorAnterior = stockAnteriorGlobal * costoAnterior;
      const valorNuevo = data.cantidad * data.costoUnitario;

      if (stockActualGlobal > 0) {
        const nuevoCostoPromedio =
          (valorAnterior + valorNuevo) / stockActualGlobal;
        await tx.producto.update({
          where: { id: data.productoId },
          data: { costoPromedio: nuevoCostoPromedio },
        });
      }
    }

    return movimiento;
  }

  async crearReceta(empresaId: number, dto: CreateRecetaDto) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);

    if (!dto.componentes?.length) {
      throw new BadRequestException('La receta debe tener al menos un insumo.');
    }

    if (dto.rendimientoObjetivo <= 0) {
      throw new BadRequestException(
        'El rendimiento objetivo debe ser mayor a 0.',
      );
    }

    await this.validarProductoEmpresa(empresaId, dto.productoFinalId, 'producto final');

    const componentes = await Promise.all(
      dto.componentes.map(async (item, index) => {
        if (item.cantidadBase <= 0) {
          throw new BadRequestException(
            `La cantidad base del componente en posición ${index + 1} debe ser mayor a 0.`,
          );
        }
        if (item.productoInsumoId === dto.productoFinalId) {
          throw new BadRequestException(
            'El producto final no puede ser también insumo de la misma receta.',
          );
        }

        await this.validarProductoEmpresa(
          empresaId,
          item.productoInsumoId,
          'insumo',
        );

        return {
          productoInsumoId: item.productoInsumoId,
          cantidadBase: item.cantidadBase,
          unidadBase: item.unidadBase,
          mermaEsperadaPorcentaje: item.mermaEsperadaPorcentaje ?? 0,
          esOpcional: item.esOpcional ?? false,
          orden: item.orden ?? index + 1,
        };
      }),
    );

    try {
      return await this.prisma.recetaProduccion.create({
        data: {
          empresaId,
          productoFinalId: dto.productoFinalId,
          codigo: dto.codigo.trim().toUpperCase(),
          nombre: dto.nombre.trim(),
          version: dto.version ?? 1,
          rendimientoObjetivo: dto.rendimientoObjetivo,
          unidadRendimiento: dto.unidadRendimiento.trim(),
          mermaObjetivoPorcentaje: dto.mermaObjetivoPorcentaje ?? 0,
          activo: dto.activo ?? true,
          observaciones: dto.observaciones?.trim(),
          componentes: {
            create: componentes,
          },
        },
        include: {
          productoFinal: {
            select: { id: true, codigo: true, descripcion: true },
          },
          componentes: {
            include: {
              productoInsumo: {
                select: { id: true, codigo: true, descripcion: true },
              },
            },
            orderBy: { orden: 'asc' },
          },
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          'Ya existe una receta con ese código y versión.',
        );
      }
      throw error;
    }
  }

  async obtenerConfiguracionProduccion(empresaId: number) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { metodoSalidaLotes: true },
    });
    return {
      metodoSalidaLotes: this.normalizarMetodoSalidaLotes(
        empresa?.metodoSalidaLotes ?? process.env.PRODUCCION_LOTES_SALIDA,
      ),
    };
  }

  async actualizarConfiguracionProduccion(
    empresaId: number,
    dto: UpdateMetodoSalidaDto,
    usuarioId?: number,
  ) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const configActual = await this.obtenerConfiguracionProduccion(empresaId);
    const metodoSalidaLotes = this.normalizarMetodoSalidaLotes(
      dto.metodoSalidaLotes,
    );
    if (configActual.metodoSalidaLotes === metodoSalidaLotes) {
      return { metodoSalidaLotes };
    }

    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { metodoSalidaLotes },
      select: { id: true },
    });

    const autor = usuarioId
      ? await this.prisma.usuario.findUnique({
          where: { id: usuarioId },
          select: { nombre: true, email: true },
        })
      : null;

    await this.prisma.empresaLog.create({
      data: {
        empresaId,
        accion: 'PRODUCCION_METODO_SALIDA_ACTUALIZADO',
        detalle: `Método de salida cambiado de ${configActual.metodoSalidaLotes} a ${metodoSalidaLotes}`,
        autorNombre: autor?.nombre ?? 'Sistema',
        autorEmail: autor?.email ?? 'sistema@falconext.local',
      },
    });

    return { metodoSalidaLotes };
  }

  async listarHistorialConfiguracionProduccion(empresaId: number, limit = 8) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 30));
    return this.prisma.empresaLog.findMany({
      where: {
        empresaId,
        accion: 'PRODUCCION_METODO_SALIDA_ACTUALIZADO',
      },
      orderBy: { creadoEn: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        accion: true,
        detalle: true,
        autorNombre: true,
        autorEmail: true,
        creadoEn: true,
      },
    });
  }

  async listarRecetas(empresaId: number, activo?: string) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const filtroActivo =
      activo === undefined ? undefined : String(activo).toLowerCase() === 'true';

    return this.prisma.recetaProduccion.findMany({
      where: {
        empresaId,
        ...(filtroActivo === undefined ? {} : { activo: filtroActivo }),
      },
      include: {
        productoFinal: {
          select: { id: true, codigo: true, descripcion: true },
        },
        _count: { select: { componentes: true, ordenes: true } },
      },
      orderBy: [{ activo: 'desc' }, { creadoEn: 'desc' }],
    });
  }

  async obtenerReceta(empresaId: number, recetaId: number) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const receta = await this.prisma.recetaProduccion.findFirst({
      where: { id: recetaId, empresaId },
      include: {
        productoFinal: {
          select: { id: true, codigo: true, descripcion: true },
        },
        componentes: {
          include: {
            productoInsumo: {
              select: { id: true, codigo: true, descripcion: true, stock: true },
            },
          },
          orderBy: { orden: 'asc' },
        },
      },
    });

    if (!receta) {
      throw new NotFoundException('Receta no encontrada.');
    }

    return receta;
  }

  async actualizarReceta(empresaId: number, recetaId: number, dto: UpdateRecetaDto) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    await this.obtenerRecetaEmpresa(empresaId, recetaId);

    if (dto.productoFinalId) {
      await this.validarProductoEmpresa(
        empresaId,
        dto.productoFinalId,
        'producto final',
      );
    }

    let componentes: any[] | null = null;
    if (dto.componentes) {
      if (!dto.componentes.length) {
        throw new BadRequestException(
          'La receta no puede quedarse sin componentes.',
        );
      }
      componentes = await Promise.all(
        dto.componentes.map(async (item, index) => {
          if (item.cantidadBase <= 0) {
            throw new BadRequestException(
              `La cantidad base del componente en posición ${index + 1} debe ser mayor a 0.`,
            );
          }
          await this.validarProductoEmpresa(
            empresaId,
            item.productoInsumoId,
            'insumo',
          );

          return {
            productoInsumoId: item.productoInsumoId,
            cantidadBase: item.cantidadBase,
            unidadBase: item.unidadBase,
            mermaEsperadaPorcentaje: item.mermaEsperadaPorcentaje ?? 0,
            esOpcional: item.esOpcional ?? false,
            orden: item.orden ?? index + 1,
          };
        }),
      );
    }

    const data: Prisma.RecetaProduccionUpdateInput = {
      ...(dto.productoFinalId !== undefined
        ? { productoFinal: { connect: { id: dto.productoFinalId } } }
        : {}),
      ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim().toUpperCase() } : {}),
      ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
      ...(dto.version !== undefined ? { version: dto.version } : {}),
      ...(dto.rendimientoObjetivo !== undefined
        ? { rendimientoObjetivo: dto.rendimientoObjetivo }
        : {}),
      ...(dto.unidadRendimiento !== undefined
        ? { unidadRendimiento: dto.unidadRendimiento.trim() }
        : {}),
      ...(dto.mermaObjetivoPorcentaje !== undefined
        ? { mermaObjetivoPorcentaje: dto.mermaObjetivoPorcentaje }
        : {}),
      ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      ...(dto.observaciones !== undefined
        ? { observaciones: dto.observaciones?.trim() || null }
        : {}),
      ...(componentes
        ? {
            componentes: {
              deleteMany: {},
              create: componentes,
            },
          }
        : {}),
    };

    try {
      return await this.prisma.recetaProduccion.update({
        where: { id: recetaId },
        data,
        include: {
          productoFinal: {
            select: { id: true, codigo: true, descripcion: true },
          },
          componentes: {
            include: {
              productoInsumo: {
                select: { id: true, codigo: true, descripcion: true },
              },
            },
            orderBy: { orden: 'asc' },
          },
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          'Ya existe una receta con ese código y versión.',
        );
      }
      throw error;
    }
  }

  async crearOrden(empresaId: number, dto: CreateOrdenProduccionDto) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);

    if (!dto.recetaId && !dto.productoFinalId) {
      throw new BadRequestException(
        'Debes enviar recetaId o productoFinalId para crear la orden.',
      );
    }
    if (dto.cantidadObjetivo <= 0) {
      throw new BadRequestException('La cantidad objetivo debe ser mayor a 0.');
    }

    let receta: Awaited<ReturnType<typeof this.obtenerRecetaEmpresa>> | null = null;
    if (dto.recetaId) {
      receta = await this.obtenerRecetaEmpresa(empresaId, dto.recetaId);
    }

    const productoFinalId = dto.productoFinalId ?? receta?.productoFinalId;
    if (!productoFinalId) {
      throw new BadRequestException(
        'No se pudo determinar el producto final para la orden.',
      );
    }

    await this.validarProductoEmpresa(empresaId, productoFinalId, 'producto final');

    if (dto.usuarioResponsableId) {
      const usuario = await this.prisma.usuario.findFirst({
        where: { id: dto.usuarioResponsableId, empresaId },
        select: { id: true },
      });
      if (!usuario) {
        throw new BadRequestException(
          'El usuario responsable no pertenece a la empresa.',
        );
      }
    }

    let componentesOrden: Array<{
      productoInsumoId: number;
      cantidadTeorica: number;
      cantidadConsumida: number;
      mermaCantidad: number;
      unidad: string;
      costoUnitario: number;
      costoTotal: number;
      observacion: string | null;
    }> = [];

    if (dto.componentes?.length) {
      componentesOrden = await Promise.all(
        dto.componentes.map(async (item) => {
          if (item.cantidadTeorica <= 0) {
            throw new BadRequestException(
              'Cada componente manual debe tener cantidad teórica mayor a 0.',
            );
          }
          const insumo = await this.validarProductoEmpresa(
            empresaId,
            item.productoInsumoId,
            'insumo',
          );
          const costoUnitario = Number(item.costoUnitario ?? insumo.costoPromedio ?? 0);
          return {
            productoInsumoId: item.productoInsumoId,
            cantidadTeorica: item.cantidadTeorica,
            cantidadConsumida: 0,
            mermaCantidad: 0,
            unidad: item.unidad,
            costoUnitario,
            costoTotal: Number(item.cantidadTeorica) * costoUnitario,
            observacion: item.observacion?.trim() || null,
          };
        }),
      );
    } else if (receta) {
      const factor = Number(dto.cantidadObjetivo) / Number(receta.rendimientoObjetivo);
      componentesOrden = await Promise.all(
        receta.componentes.map(async (item) => {
          const insumo = await this.validarProductoEmpresa(
            empresaId,
            item.productoInsumoId,
            'insumo',
          );
          const cantidadTeorica = Number(item.cantidadBase) * factor;
          const costoUnitario = Number(insumo.costoPromedio ?? 0);
          return {
            productoInsumoId: item.productoInsumoId,
            cantidadTeorica,
            cantidadConsumida: 0,
            mermaCantidad: 0,
            unidad: item.unidadBase,
            costoUnitario,
            costoTotal: cantidadTeorica * costoUnitario,
            observacion: null,
          };
        }),
      );
    } else {
      throw new BadRequestException(
        'Si no envías receta, debes enviar componentes manuales.',
      );
    }

    if (!componentesOrden.length) {
      throw new BadRequestException(
        'La orden debe tener al menos un componente.',
      );
    }

    try {
      return await this.prisma.ordenProduccion.create({
        data: {
          empresaId,
          recetaId: receta?.id ?? null,
          productoFinalId,
          loteProduccion: dto.loteProduccion.trim().toUpperCase(),
          fechaProgramada: dto.fechaProgramada ? new Date(dto.fechaProgramada) : null,
          cantidadObjetivo: dto.cantidadObjetivo,
          estado: 'PLANIFICADA',
          observaciones: dto.observaciones?.trim(),
          usuarioResponsableId: dto.usuarioResponsableId,
          componentes: {
            create: componentesOrden,
          },
        },
        include: {
          receta: { select: { id: true, codigo: true, nombre: true, version: true } },
          productoFinal: {
            select: { id: true, codigo: true, descripcion: true, stock: true },
          },
          componentes: {
            include: {
              productoInsumo: {
                select: { id: true, codigo: true, descripcion: true, stock: true },
              },
            },
            orderBy: { id: 'asc' },
          },
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          'Ya existe una orden con ese lote de producción.',
        );
      }
      throw error;
    }
  }

  async listarOrdenes(empresaId: number, query: any) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const {
      estado,
      productoFinalId,
      fechaDesde,
      fechaHasta,
      page = 1,
      limit = 20,
    } = query || {};

    const where: Prisma.OrdenProduccionWhereInput = {
      empresaId,
      ...(estado ? { estado } : {}),
      ...(productoFinalId ? { productoFinalId: Number(productoFinalId) } : {}),
      ...(fechaDesde || fechaHasta
        ? {
            creadoEn: {
              ...(fechaDesde ? { gte: new Date(fechaDesde) } : {}),
              ...(fechaHasta
                ? { lte: new Date(`${fechaHasta}T23:59:59.999`) }
                : {}),
            },
          }
        : {}),
    };

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.max(Number(limit) || 20, 1);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      this.prisma.ordenProduccion.findMany({
        where,
        include: {
          receta: {
            select: {
              id: true,
              codigo: true,
              nombre: true,
              mermaObjetivoPorcentaje: true,
            },
          },
          productoFinal: {
            select: { id: true, codigo: true, descripcion: true },
          },
          usuarioResponsable: {
            select: { id: true, nombre: true, email: true },
          },
          componentes: {
            select: {
              mermaCantidad: true,
              costoUnitario: true,
            },
          },
          _count: { select: { componentes: true, movimientos: true } },
        },
        orderBy: [{ creadoEn: 'desc' }],
        skip,
        take: safeLimit,
      }),
      this.prisma.ordenProduccion.count({ where }),
    ]);

    const data = items.map((item) => {
      const mermaValorizada = item.componentes.reduce((acc, comp) => {
        const mermaCantidad = Number(comp.mermaCantidad || 0);
        const costoUnitario = Number(comp.costoUnitario || 0);
        return acc + mermaCantidad * costoUnitario;
      }, 0);

      return {
        ...item,
        mermaValorizada,
      };
    });

    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async obtenerOrden(empresaId: number, ordenId: number) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);

    const orden = await this.prisma.ordenProduccion.findFirst({
      where: { id: ordenId, empresaId },
      include: {
        receta: { select: { id: true, codigo: true, nombre: true, version: true } },
        productoFinal: {
          select: { id: true, codigo: true, descripcion: true, stock: true },
        },
        usuarioResponsable: {
          select: { id: true, nombre: true, email: true },
        },
        componentes: {
          include: {
            productoInsumo: {
              select: { id: true, codigo: true, descripcion: true, stock: true },
            },
          },
          orderBy: { id: 'asc' },
        },
        movimientos: {
          include: {
            producto: {
              select: { id: true, codigo: true, descripcion: true },
            },
            usuario: { select: { id: true, nombre: true } },
          },
          orderBy: { fecha: 'desc' },
        },
      },
    });

    if (!orden) {
      throw new NotFoundException('Orden de producción no encontrada.');
    }

    return orden;
  }

  async actualizarEstadoOrden(
    empresaId: number,
    ordenId: number,
    dto: UpdateEstadoOrdenDto,
  ) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);

    const orden = await this.prisma.ordenProduccion.findFirst({
      where: { id: ordenId, empresaId },
      select: { id: true, estado: true, fechaInicio: true, fechaFin: true },
    });

    if (!orden) {
      throw new NotFoundException('Orden de producción no encontrada.');
    }

    if (orden.estado === 'FINALIZADA') {
      throw new BadRequestException(
        'La orden ya está FINALIZADA. No puede cambiarse su estado.',
      );
    }

    const data: Prisma.OrdenProduccionUpdateInput = {
      estado: dto.estado,
      ...(dto.estado === 'EN_PROCESO' && !orden.fechaInicio
        ? { fechaInicio: new Date() }
        : {}),
      ...(dto.estado === 'ANULADA' && !orden.fechaFin ? { fechaFin: new Date() } : {}),
    };

    return this.prisma.ordenProduccion.update({
      where: { id: ordenId },
      data,
    });
  }

  async registrarEjecucionOrden(
    empresaId: number,
    ordenId: number,
    usuarioId: number,
    dto: RegistrarEjecucionOrdenDto,
    sedeId?: number,
  ) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const sedeIdProduccion = await this.resolverSedeIdProduccion(empresaId, sedeId);

    if (!dto.componentes?.length) {
      throw new BadRequestException(
        'Debes enviar al menos un componente ejecutado.',
      );
    }
    if (dto.cantidadProducida <= 0) {
      throw new BadRequestException('La cantidad producida debe ser mayor a 0.');
    }

    const orden = await this.prisma.ordenProduccion.findFirst({
      where: { id: ordenId, empresaId },
      include: {
        componentes: true,
      },
    });

    if (!orden) {
      throw new NotFoundException('Orden de producción no encontrada.');
    }

    if (orden.estado === 'ANULADA') {
      throw new BadRequestException('No se puede ejecutar una orden ANULADA.');
    }
    if (orden.estado === 'FINALIZADA') {
      throw new BadRequestException('La orden ya fue finalizada.');
    }

    const componentesOrdenMap = new Map(
      orden.componentes.map((item) => [item.productoInsumoId, item]),
    );
    const idsProductosInvolucrados = Array.from(
      new Set([
        ...dto.componentes.map((item) => item.productoInsumoId),
        orden.productoFinalId,
      ]),
    );
    const productosInvolucrados = await this.prisma.producto.findMany({
      where: {
        empresaId,
        id: { in: idsProductosInvolucrados },
      },
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        factorConversion: true,
        costoPromedio: true,
      },
    });
    const productosMap = new Map(
      productosInvolucrados.map((item) => [item.id, item]),
    );

    const updatesComponentes: Array<{
      id: number;
      cantidadConsumida: number;
      mermaCantidad: number;
      costoUnitario: number;
      costoTotal: number;
      observacion?: string | null;
    }> = [];

    const movimientos: Prisma.MovimientoProduccionCreateManyInput[] = [];
    const salidasKardex: Array<{
      productoId: number;
      cantidadStock: number;
      costoUnitarioStock: number;
      observacion: string;
    }> = [];
    let mermaAcumulada = 0;
    let costoTotalConsumido = 0;

    for (const item of dto.componentes) {
      const componenteOrden = componentesOrdenMap.get(item.productoInsumoId);
      if (!componenteOrden) {
        throw new BadRequestException(
          `El insumo ${item.productoInsumoId} no pertenece a esta orden.`,
        );
      }

      if (item.cantidadConsumida < 0) {
        throw new BadRequestException(
          `La cantidad consumida del insumo ${item.productoInsumoId} no puede ser negativa.`,
        );
      }
      if ((item.mermaCantidad ?? 0) < 0) {
        throw new BadRequestException(
          `La merma del insumo ${item.productoInsumoId} no puede ser negativa.`,
        );
      }

      const merma = Number(item.mermaCantidad ?? 0);
      const costoUnitario = Number(componenteOrden.costoUnitario ?? 0);
      const costoConsumo = Number(item.cantidadConsumida) * costoUnitario;
      const productoInsumo = productosMap.get(item.productoInsumoId);
      if (!productoInsumo) {
        throw new BadRequestException(
          `No se encontró configuración del insumo ${item.productoInsumoId}.`,
        );
      }
      const factorInsumo = Number(productoInsumo.factorConversion ?? 1);
      const cantidadSalidaDecimal = Number(item.cantidadConsumida) + merma;
      const cantidadSalidaStock = this.convertirAUnidadesStock(
        cantidadSalidaDecimal,
        factorInsumo,
        `insumo ${productoInsumo.codigo} - ${productoInsumo.descripcion}`,
      );
      const costoUnitarioStock =
        factorInsumo > 0 ? costoUnitario / factorInsumo : 0;

      updatesComponentes.push({
        id: componenteOrden.id,
        cantidadConsumida: Number(item.cantidadConsumida),
        mermaCantidad: merma,
        costoUnitario,
        costoTotal: Number(componenteOrden.cantidadTeorica) * costoUnitario,
        observacion: item.observacion?.trim() || null,
      });

      if (item.cantidadConsumida > 0) {
        movimientos.push({
          ordenProduccionId: orden.id,
          empresaId,
          productoId: item.productoInsumoId,
          tipoMovimiento: 'CONSUMO_INSUMO',
          cantidad: item.cantidadConsumida,
          unidad: componenteOrden.unidad,
          costoUnitario,
          costoTotal: costoConsumo,
          mermaCantidad: 0,
          fecha: dto.fechaFin ? new Date(dto.fechaFin) : new Date(),
          usuarioId,
          observacion: item.observacion?.trim(),
        });
      }

      if (merma > 0) {
        movimientos.push({
          ordenProduccionId: orden.id,
          empresaId,
          productoId: item.productoInsumoId,
          tipoMovimiento: 'MERMA',
          cantidad: merma,
          unidad: componenteOrden.unidad,
          costoUnitario,
          costoTotal: merma * costoUnitario,
          mermaCantidad: merma,
          fecha: dto.fechaFin ? new Date(dto.fechaFin) : new Date(),
          usuarioId,
          observacion: item.observacion?.trim(),
        });
      }

      salidasKardex.push({
        productoId: item.productoInsumoId,
        cantidadStock: cantidadSalidaStock,
        costoUnitarioStock,
        observacion: `Consumo: ${item.cantidadConsumida} | Merma: ${merma}`,
      });

      mermaAcumulada += merma;
      costoTotalConsumido += costoConsumo;
    }

    const mermaTotal = dto.mermaTotal ?? mermaAcumulada;
    const costoUnitarioFinal =
      dto.cantidadProducida > 0 ? costoTotalConsumido / dto.cantidadProducida : 0;
    const productoFinal = productosMap.get(orden.productoFinalId);
    if (!productoFinal) {
      throw new BadRequestException(
        'No se encontró configuración del producto final.',
      );
    }
    const factorProductoFinal = Number(productoFinal.factorConversion ?? 1);
    const cantidadIngresoStock = this.convertirAUnidadesStock(
      Number(dto.cantidadProducida),
      factorProductoFinal,
      `producto final ${productoFinal.codigo} - ${productoFinal.descripcion}`,
    );
    const costoUnitarioFinalStock =
      factorProductoFinal > 0 ? costoUnitarioFinal / factorProductoFinal : 0;

    movimientos.push({
      ordenProduccionId: orden.id,
      empresaId,
      productoId: orden.productoFinalId,
      tipoMovimiento: 'INGRESO_PRODUCTO_FINAL',
      cantidad: dto.cantidadProducida,
      unidad: 'UN',
      costoUnitario: costoUnitarioFinal,
      costoTotal: costoUnitarioFinal * dto.cantidadProducida,
      mermaCantidad: 0,
      fecha: dto.fechaFin ? new Date(dto.fechaFin) : new Date(),
      usuarioId,
      observacion: dto.observaciones?.trim(),
    });

    await this.prisma.$transaction(async (tx) => {
      const metodoSalidaLotes = await this.obtenerMetodoSalidaLotes(
        empresaId,
        tx,
      );

      for (const componente of updatesComponentes) {
        await tx.ordenProduccionComponente.update({
          where: { id: componente.id },
          data: {
            cantidadConsumida: componente.cantidadConsumida,
            mermaCantidad: componente.mermaCantidad,
            costoUnitario: componente.costoUnitario,
            costoTotal: componente.costoTotal,
            observacion: componente.observacion,
          },
        });
      }

      await tx.movimientoProduccion.createMany({
        data: movimientos,
      });

      for (const salida of salidasKardex) {
        const distribucionLotes = await this.distribuirSalidaEnLotesEnTx(
          tx,
          salida.productoId,
          salida.cantidadStock,
          metodoSalidaLotes,
        );

        if (!distribucionLotes.length) {
          await this.registrarMovimientoKardexEnTx(tx, {
            productoId: salida.productoId,
            empresaId,
            sedeId: sedeIdProduccion,
            usuarioId,
            tipoMovimiento: 'SALIDA',
            concepto: `PRODUCCIÓN ${orden.loteProduccion} - CONSUMO`,
            cantidad: salida.cantidadStock,
            costoUnitario: salida.costoUnitarioStock,
            observacion: salida.observacion,
          });
          continue;
        }

        for (const bloque of distribucionLotes) {
          const movimiento = await this.registrarMovimientoKardexEnTx(tx, {
            productoId: salida.productoId,
            empresaId,
            sedeId: sedeIdProduccion,
            usuarioId,
            tipoMovimiento: 'SALIDA',
            concepto: `PRODUCCIÓN ${orden.loteProduccion} - CONSUMO`,
            cantidad: bloque.cantidad,
            costoUnitario: salida.costoUnitarioStock,
            observacion: `${salida.observacion} | Lote: ${bloque.lote}`,
          });

          if (!movimiento) continue;

          await tx.productoLote.update({
            where: { id: bloque.loteId },
            data: { stockActual: { decrement: bloque.cantidad } },
          });

          await tx.movimientoKardexLote.create({
            data: {
              productoLoteId: bloque.loteId,
              movimientoId: movimiento.id,
              cantidad: bloque.cantidad,
              stockAnterior: bloque.stockAnterior,
              stockActual: bloque.stockActual,
            },
          });
        }
      }

      await this.registrarMovimientoKardexEnTx(tx, {
        productoId: orden.productoFinalId,
        empresaId,
        sedeId: sedeIdProduccion,
        usuarioId,
        tipoMovimiento: 'INGRESO',
        concepto: `PRODUCCIÓN ${orden.loteProduccion} - PRODUCTO FINAL`,
        cantidad: cantidadIngresoStock,
        costoUnitario: costoUnitarioFinalStock,
        observacion: `Producción final: ${dto.cantidadProducida}`,
      });

      await tx.ordenProduccion.update({
        where: { id: orden.id },
        data: {
          fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : orden.fechaInicio ?? new Date(),
          fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : new Date(),
          cantidadProducida: dto.cantidadProducida,
          mermaTotal,
          observaciones: dto.observaciones ?? orden.observaciones,
          estado: 'FINALIZADA',
        },
      });
    });

    return this.obtenerOrden(empresaId, orden.id);
  }

  async resumenMaterialesOrden(empresaId: number, ordenId: number) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);
    const orden = await this.prisma.ordenProduccion.findFirst({
      where: { id: ordenId, empresaId },
      include: {
        componentes: {
          include: {
            productoInsumo: {
              select: { id: true, codigo: true, descripcion: true },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!orden) {
      throw new NotFoundException('Orden de producción no encontrada.');
    }

    const detalle = orden.componentes.map((comp) => {
      const teorica = Number(comp.cantidadTeorica);
      const consumida = Number(comp.cantidadConsumida);
      const merma = Number(comp.mermaCantidad);
      const costoUnitario = Number(comp.costoUnitario || 0);
      const sobrante = teorica - consumida;
      const excesoConsumo = consumida > teorica ? consumida - teorica : 0;
      const mermaPct = consumida > 0 ? (merma / consumida) * 100 : 0;
      const mermaValorizada = merma * costoUnitario;
      return {
        componenteId: comp.id,
        productoInsumoId: comp.productoInsumoId,
        codigo: comp.productoInsumo.codigo,
        descripcion: comp.productoInsumo.descripcion,
        unidad: comp.unidad,
        cantidadTeorica: teorica,
        cantidadConsumida: consumida,
        cantidadSobrante: sobrante > 0 ? sobrante : 0,
        excesoConsumo,
        mermaCantidad: merma,
        mermaPorcentajeReal: mermaPct,
        costoUnitario,
        mermaValorizada,
      };
    });

    return {
      ordenId: orden.id,
      estado: orden.estado,
      componentes: detalle,
      totales: {
        teorico: detalle.reduce((acc, item) => acc + item.cantidadTeorica, 0),
        consumido: detalle.reduce((acc, item) => acc + item.cantidadConsumida, 0),
        merma: detalle.reduce((acc, item) => acc + item.mermaCantidad, 0),
        mermaValorizada: detalle.reduce(
          (acc, item) => acc + item.mermaValorizada,
          0,
        ),
      },
    };
  }

  private textoPlano(value: unknown): string {
    return String(value ?? '').trim();
  }

  private resolverUmbSunat(raw: string | undefined): string {
    const alias: Record<string, string> = {
      KG: 'KGM', KGS: 'KGM', KILO: 'KGM', KILOGRAMO: 'KGM',
      UN: 'NIU', UND: 'NIU', UNID: 'NIU', UNIDAD: 'NIU', ETIQ: 'NIU', PZA: 'NIU', PZ: 'NIU',
      LT: 'LTR', LTS: 'LTR', LITRO: 'LTR',
      MT: 'MTR', MTS: 'MTR', METRO: 'MTR',
    };
    if (!raw) return 'NIU';
    const key = raw.trim().toUpperCase();
    return alias[key] ?? key;
  }

  private clavePlano(value: unknown): string {
    return this.textoPlano(value)
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private numeroSeguro(value: unknown, fallback = 0): number {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private fechaExcelAISO(value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const parsed = new Date(excelEpoch.getTime() + value * 86400000);
      if (Number.isNaN(parsed.getTime())) return undefined;
      return parsed.toISOString().slice(0, 10);
    }
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 10);
  }

  private valorFila(row: Record<string, any>, keys: string[]) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    }
    return undefined;
  }

  private resolverUnidadId(
    unidadRaw: string,
    unidadMap: Map<string, number>,
  ): number | undefined {
    const key = this.clavePlano(unidadRaw);
    if (!key) return undefined;

    const direct = unidadMap.get(key);
    if (direct) return direct;

    const aliases: Record<string, string[]> = {
      KG: ['KGM', 'KILO', 'KILOGRAMO', 'KILOGRAMOS'],
      KGS: ['KGM', 'KG', 'KILO', 'KILOGRAMO', 'KILOGRAMOS'],
      GR: ['GRM', 'GRAMO', 'GRAMOS'],
      G: ['GRM', 'GR', 'GRAMO', 'GRAMOS'],
      LT: ['LTR', 'LITRO', 'LITROS'],
      LTS: ['LTR', 'LT', 'LITRO', 'LITROS'],
      L: ['LTR', 'LT', 'LITRO', 'LITROS'],
      ML: ['MLT', 'MILILITRO', 'MILILITROS'],
      MLS: ['MLT', 'ML', 'MILILITRO', 'MILILITROS'],
      UN: ['NIU', 'UNIDAD', 'UNIDADES'],
      UND: ['NIU', 'UN', 'UNIDAD', 'UNIDADES'],
      U: ['NIU', 'UN', 'UNIDAD', 'UNIDADES'],
    };

    const candidates = aliases[key] || [];
    for (const candidate of candidates) {
      const found = unidadMap.get(this.clavePlano(candidate));
      if (found) return found;
    }

    return undefined;
  }

  async generarPlantillaCargaMasiva(empresaId: number): Promise<Buffer> {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);

    const wb = XLSX.utils.book_new();
    const unidades = await this.prisma.unidadMedida.findMany({
      select: { codigo: true, nombre: true },
      orderBy: { codigo: 'asc' },
    });

    const infoAoa = [
      ['FALCONEXT - Plantilla Fabricación y Producción'],
      [''],
      ['SHEET PRODUCTOS -> Catálogo de insumos, envases, semielaborados y productos terminados.'],
      ['SHEET RECETAS -> Una fila por componente de receta.'],
      ['SHEET ORDENES -> Opcional, crea órdenes en BORRADOR desde recetas existentes.'],
      [''],
      ['Reglas importantes'],
      ['1) No cambies nombres de columnas.'],
      ['2) CODIGO debe ser único por empresa.'],
      ['3) UMB usa código de la hoja UNIDADES (GR, ML, KG, LT, UN, etc).'],
      ['4) AFECTACION usa 10, 20, 30 o 40.'],
      ['5) En RECETAS, cada componente va en una fila con mismo RECETA_CODIGO/RECETA_VERSION.'],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoAoa);
    wsInfo['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'LEEME');

    const wsUnidades = XLSX.utils.json_to_sheet(
      unidades.map((u) => ({ CODIGO: u.codigo, NOMBRE: u.nombre })),
    );
    wsUnidades['!cols'] = [{ wch: 12 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, wsUnidades, 'UNIDADES');

    const productosHeaders = [
      // INSUMOS BASE
      {
        TIPO: 'INSUMO',
        CODIGO: '2001004',
        DESCRIPCION: 'TEXAPON 70% (DETERGENTE)',
        UMB: 'KG',
        COSTO_UNITARIO: 22.5,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 120,
        CATEGORIA: 'INSUMOS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'INSUMO',
        CODIGO: '2001002',
        DESCRIPCION: 'BETAINA 35% (ESPUMANTE)',
        UMB: 'KG',
        COSTO_UNITARIO: 19.8,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 90,
        CATEGORIA: 'INSUMOS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'INSUMO',
        CODIGO: '2001001',
        DESCRIPCION: 'COMPERLAND KD (ESPESANTE)',
        UMB: 'KG',
        COSTO_UNITARIO: 28.4,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 40,
        CATEGORIA: 'INSUMOS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'INSUMO',
        CODIGO: '3001001',
        DESCRIPCION: 'AGUA DESIONISADA O AGUA POTABLE',
        UMB: 'LT',
        COSTO_UNITARIO: 0.85,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 1200,
        CATEGORIA: 'INSUMOS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'INSUMO',
        CODIGO: '1004013',
        DESCRIPCION: 'ESENCIA DE AROMA TUTIFRUTI',
        UMB: 'ML',
        COSTO_UNITARIO: 0.03,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 10000,
        CATEGORIA: 'INSUMOS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'INSUMO',
        CODIGO: '2001005',
        DESCRIPCION: 'CLORURO DE SODIO (SAL)',
        UMB: 'GR',
        COSTO_UNITARIO: 0.01,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 50000,
        CATEGORIA: 'INSUMOS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      // ENVASES Y ETIQUETAS
      {
        TIPO: 'ENVASE',
        CODIGO: '7001026',
        DESCRIPCION: 'CAQUETA GALONERA 1LT',
        UMB: 'UN',
        COSTO_UNITARIO: 1.45,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 500,
        CATEGORIA: 'ENVASES',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'ENVASE',
        CODIGO: 'ETIQ011.SHCE1',
        DESCRIPCION: 'ETIQUETA SHAMPOO CERA GAL 1LT',
        UMB: 'UN',
        COSTO_UNITARIO: 0.18,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 500,
        CATEGORIA: 'ETIQUETAS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'ENVASE',
        CODIGO: '7001002',
        DESCRIPCION: 'ENVASE 3.8LT',
        UMB: 'UN',
        COSTO_UNITARIO: 2.9,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 200,
        CATEGORIA: 'ENVASES',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'ENVASE',
        CODIGO: 'ETIQ011.SHCE3.8',
        DESCRIPCION: 'ETIQUETA SHAMPOO CERA GAL 3.8LT',
        UMB: 'UN',
        COSTO_UNITARIO: 0.24,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 200,
        CATEGORIA: 'ETIQUETAS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'ENVASE',
        CODIGO: '7001004',
        DESCRIPCION: 'ENVASE 20LT',
        UMB: 'UN',
        COSTO_UNITARIO: 8.5,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 100,
        CATEGORIA: 'ENVASES',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'ENVASE',
        CODIGO: 'ETIQ011.SHCE20',
        DESCRIPCION: 'ETIQUETA SHAMPOO CERA 20LT',
        UMB: 'UN',
        COSTO_UNITARIO: 0.35,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 100,
        CATEGORIA: 'ETIQUETAS',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      // SEMIELABORADOS
      {
        TIPO: 'SEMIELABORADO',
        CODIGO: 'GRANEL.SHCE',
        DESCRIPCION: 'SHAMPOO CERA GRANEL',
        UMB: 'LT',
        COSTO_UNITARIO: 0,
        PRECIO_VENTA: 0,
        STOCK_INICIAL: 0,
        CATEGORIA: 'SEMIELABORADO',
        MARCA: '',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      // PRODUCTOS TERMINADOS
      {
        TIPO: 'PRODUCTO_FINAL',
        CODIGO: '011.SHCE1',
        DESCRIPCION: 'SHAMPOO CERA GAL 1LT',
        UMB: 'UN',
        COSTO_UNITARIO: 4.5,
        PRECIO_VENTA: 8,
        STOCK_INICIAL: 0,
        CATEGORIA: 'PRODUCTO_TERMINADO',
        MARCA: 'MR.BULLDOG',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'PRODUCTO_FINAL',
        CODIGO: '011.SHCE3.8',
        DESCRIPCION: 'SHAMPOO CERA GAL 3.8LT',
        UMB: 'UN',
        COSTO_UNITARIO: 11.5,
        PRECIO_VENTA: 18.9,
        STOCK_INICIAL: 0,
        CATEGORIA: 'PRODUCTO_TERMINADO',
        MARCA: 'MR.BULLDOG',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
      {
        TIPO: 'PRODUCTO_FINAL',
        CODIGO: '011.SHCE20',
        DESCRIPCION: 'SHAMPOO CERA 20LT',
        UMB: 'UN',
        COSTO_UNITARIO: 38,
        PRECIO_VENTA: 55,
        STOCK_INICIAL: 0,
        CATEGORIA: 'PRODUCTO_TERMINADO',
        MARCA: 'MR.BULLDOG',
        AFECTACION: '10',
        CODIGO_BARRAS: '',
      },
    ];
    const wsProductos = XLSX.utils.json_to_sheet(productosHeaders);
    wsProductos['!cols'] = [
      { wch: 15 },
      { wch: 20 },
      { wch: 55 },
      { wch: 10 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 25 },
      { wch: 20 },
      { wch: 12 },
      { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, wsProductos, 'PRODUCTOS');

    const recetasHeaders = [
      // RECETA 1: FABRICACIÓN GRANEL
      {
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_NOMBRE: 'Fabricación granel Shampoo Cera',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: 'GRANEL.SHCE',
        RENDIMIENTO_OBJETIVO: 100,
        UMB_RENDIMIENTO: 'LT',
        MERMA_OBJETIVO_PORCENTAJE: 2,
        INSUMO_CODIGO: '2001004',
        CANTIDAD_BASE: 10,
        UMB_BASE: 'KG',
        ORDEN: 1,
      },
      {
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_NOMBRE: 'Fabricación granel Shampoo Cera',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: 'GRANEL.SHCE',
        RENDIMIENTO_OBJETIVO: 100,
        UMB_RENDIMIENTO: 'LT',
        MERMA_OBJETIVO_PORCENTAJE: 2,
        INSUMO_CODIGO: '2001002',
        CANTIDAD_BASE: 8,
        UMB_BASE: 'KG',
        ORDEN: 2,
      },
      {
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_NOMBRE: 'Fabricación granel Shampoo Cera',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: 'GRANEL.SHCE',
        RENDIMIENTO_OBJETIVO: 100,
        UMB_RENDIMIENTO: 'LT',
        MERMA_OBJETIVO_PORCENTAJE: 2,
        INSUMO_CODIGO: '2001001',
        CANTIDAD_BASE: 2.5,
        UMB_BASE: 'KG',
        ORDEN: 3,
      },
      {
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_NOMBRE: 'Fabricación granel Shampoo Cera',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: 'GRANEL.SHCE',
        RENDIMIENTO_OBJETIVO: 100,
        UMB_RENDIMIENTO: 'LT',
        MERMA_OBJETIVO_PORCENTAJE: 2,
        INSUMO_CODIGO: '3001001',
        CANTIDAD_BASE: 77.698,
        UMB_BASE: 'LT',
        ORDEN: 4,
      },
      {
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_NOMBRE: 'Fabricación granel Shampoo Cera',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: 'GRANEL.SHCE',
        RENDIMIENTO_OBJETIVO: 100,
        UMB_RENDIMIENTO: 'LT',
        MERMA_OBJETIVO_PORCENTAJE: 2,
        INSUMO_CODIGO: '1004013',
        CANTIDAD_BASE: 200,
        UMB_BASE: 'ML',
        ORDEN: 5,
      },
      {
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_NOMBRE: 'Fabricación granel Shampoo Cera',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: 'GRANEL.SHCE',
        RENDIMIENTO_OBJETIVO: 100,
        UMB_RENDIMIENTO: 'LT',
        MERMA_OBJETIVO_PORCENTAJE: 2,
        INSUMO_CODIGO: '2001005',
        CANTIDAD_BASE: 500,
        UMB_BASE: 'GR',
        ORDEN: 6,
      },
      // RECETA 2: ENVASADO 1LT
      {
        RECETA_CODIGO: 'RC-SHCE1-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 1LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE1',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0,
        INSUMO_CODIGO: 'GRANEL.SHCE',
        CANTIDAD_BASE: 1,
        UMB_BASE: 'LT',
        ORDEN: 1,
      },
      {
        RECETA_CODIGO: 'RC-SHCE1-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 1LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE1',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: '7001026',
        CANTIDAD_BASE: 1,
        UMB_BASE: 'UN',
        ORDEN: 2,
      },
      {
        RECETA_CODIGO: 'RC-SHCE1-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 1LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE1',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: 'ETIQ011.SHCE1',
        CANTIDAD_BASE: 1,
        UMB_BASE: 'UN',
        ORDEN: 3,
      },
      // RECETA 3: ENVASADO 3.8LT
      {
        RECETA_CODIGO: 'RC-SHCE38-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 3.8LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE3.8',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: 'GRANEL.SHCE',
        CANTIDAD_BASE: 3.8,
        UMB_BASE: 'LT',
        ORDEN: 1,
      },
      {
        RECETA_CODIGO: 'RC-SHCE38-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 3.8LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE3.8',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: '7001002',
        CANTIDAD_BASE: 1,
        UMB_BASE: 'UN',
        ORDEN: 2,
      },
      {
        RECETA_CODIGO: 'RC-SHCE38-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 3.8LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE3.8',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: 'ETIQ011.SHCE3.8',
        CANTIDAD_BASE: 1,
        UMB_BASE: 'UN',
        ORDEN: 3,
      },
      // RECETA 4: ENVASADO 20LT
      {
        RECETA_CODIGO: 'RC-SHCE20-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 20LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE20',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: 'GRANEL.SHCE',
        CANTIDAD_BASE: 20,
        UMB_BASE: 'LT',
        ORDEN: 1,
      },
      {
        RECETA_CODIGO: 'RC-SHCE20-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 20LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE20',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: '7001004',
        CANTIDAD_BASE: 1,
        UMB_BASE: 'UN',
        ORDEN: 2,
      },
      {
        RECETA_CODIGO: 'RC-SHCE20-ENV',
        RECETA_NOMBRE: 'Envasado Shampoo Cera 20LT',
        RECETA_VERSION: 1,
        PRODUCTO_FINAL_CODIGO: '011.SHCE20',
        RENDIMIENTO_OBJETIVO: 1,
        UMB_RENDIMIENTO: 'UN',
        MERMA_OBJETIVO_PORCENTAJE: 0.5,
        INSUMO_CODIGO: 'ETIQ011.SHCE20',
        CANTIDAD_BASE: 1,
        UMB_BASE: 'UN',
        ORDEN: 3,
      },
    ];
    const wsRecetas = XLSX.utils.json_to_sheet(recetasHeaders);
    wsRecetas['!cols'] = [
      { wch: 22 },
      { wch: 45 },
      { wch: 14 },
      { wch: 24 },
      { wch: 20 },
      { wch: 16 },
      { wch: 26 },
      { wch: 22 },
      { wch: 16 },
      { wch: 12 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, wsRecetas, 'RECETAS');

    const ordenesHeaders = [
      {
        LOTE_PRODUCCION: 'V052027',
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_VERSION: 1,
        CANTIDAD_OBJETIVO: 100,
        FECHA_PROGRAMADA: '2026-05-16',
        OBSERVACIONES: 'Lote de prueba granel',
      },
      {
        LOTE_PRODUCCION: 'V052027-ENV1',
        RECETA_CODIGO: 'RC-SHCE1-ENV',
        RECETA_VERSION: 1,
        CANTIDAD_OBJETIVO: 19,
        FECHA_PROGRAMADA: '2026-05-16',
        OBSERVACIONES: 'Envasado 1LT',
      },
      {
        LOTE_PRODUCCION: 'V052028',
        RECETA_CODIGO: 'RC-SHCE-GRANEL',
        RECETA_VERSION: 1,
        CANTIDAD_OBJETIVO: 200,
        FECHA_PROGRAMADA: '2026-05-18',
        OBSERVACIONES: 'Lote granel ampliado',
      },
      {
        LOTE_PRODUCCION: 'V052028-ENV38',
        RECETA_CODIGO: 'RC-SHCE38-ENV',
        RECETA_VERSION: 1,
        CANTIDAD_OBJETIVO: 25,
        FECHA_PROGRAMADA: '2026-05-18',
        OBSERVACIONES: 'Envasado 3.8LT',
      },
      {
        LOTE_PRODUCCION: 'V052028-ENV20',
        RECETA_CODIGO: 'RC-SHCE20-ENV',
        RECETA_VERSION: 1,
        CANTIDAD_OBJETIVO: 8,
        FECHA_PROGRAMADA: '2026-05-18',
        OBSERVACIONES: 'Envasado 20LT',
      },
    ];
    const wsOrdenes = XLSX.utils.json_to_sheet(ordenesHeaders);
    wsOrdenes['!cols'] = [
      { wch: 24 },
      { wch: 22 },
      { wch: 14 },
      { wch: 18 },
      { wch: 18 },
      { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(wb, wsOrdenes, 'ORDENES');

    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  }

  private leerProductosFormatoPersonalizado(
    workbook: XLSX.WorkBook,
  ): Record<string, any>[] {
    const productos: Record<string, any>[] = [];

    const buscarFilaHeaders = (filas: any[][], marcas: string[]): number => {
      for (let i = 0; i < Math.min(filas.length, 5); i++) {
        if (marcas.some((m) => (filas[i] as any[]).includes(m))) return i;
      }
      return -1;
    };

    // INV.INSUM. → INSUMO (fila 0 es título, fila 1 son headers reales)
    const sheetInsumos = workbook.Sheets['INV.INSUM.'];
    if (sheetInsumos) {
      const filas = XLSX.utils.sheet_to_json(sheetInsumos, {
        header: 1,
      }) as any[][];
      const hIdx = buscarFilaHeaders(filas, ['SKU', 'NOMBRES']);
      if (hIdx >= 0) {
        const headers: any[] = filas[hIdx];
        const skuIdx = headers.indexOf('SKU');
        const nombreIdx = headers.indexOf('NOMBRES');
        const precioKgIdx = headers.indexOf('Precio x kg');
        const costoIdx = headers.indexOf('Costo sin igv');
        const invIdx = headers.indexOf('Inventario');
        const familiaIdx = headers.findIndex((h: any) => h && String(h).toUpperCase() === 'FAMILIA');
        for (let i = hIdx + 1; i < filas.length; i++) {
          const f = filas[i];
          if (!f[skuIdx] || !f[nombreIdx]) continue;
          productos.push({
            CODIGO: String(f[skuIdx]),
            DESCRIPCION: String(f[nombreIdx]),
            UMB: 'KGM',
            COSTO_UNITARIO: costoIdx >= 0 ? (f[costoIdx] ?? 0) : 0,
            PRECIO_VENTA: precioKgIdx >= 0 ? (f[precioKgIdx] ?? 0) : (costoIdx >= 0 ? (f[costoIdx] ?? 0) : 0),
            STOCK_INICIAL: invIdx >= 0 ? (f[invIdx] ?? 0) : 0,
            CATEGORIA:
              familiaIdx >= 0 && f[familiaIdx]
                ? String(f[familiaIdx])
                : 'INSUMOS',
            AFECTACION: '10',
          });
        }
      }
    }

    // INV. ETIQ. → ENVASE (fila 0 es título "ETIQUETAS", fila 1 son headers)
    const sheetEtiq = workbook.Sheets['INV. ETIQ.'];
    if (sheetEtiq) {
      const filas = XLSX.utils.sheet_to_json(sheetEtiq, {
        header: 1,
      }) as any[][];
      const hIdx = buscarFilaHeaders(filas, ['COD.', 'NOMBRES']);
      if (hIdx >= 0) {
        const headers: any[] = filas[hIdx];
        const codIdx = headers.indexOf('COD.');
        const nombreIdx = headers.indexOf('NOMBRES');
        const costoSinIgvIdx = headers.indexOf('COSTO SIN IGV');
        const precioIdx = headers.indexOf('PRECIO');
        const umbIdx = headers.indexOf('UMB');
        const invIdx = headers.findIndex(
          (h: any) =>
            h && String(h).toLowerCase().startsWith('inventario'),
        );
        for (let i = hIdx + 1; i < filas.length; i++) {
          const f = filas[i];
          if (!f[codIdx] || !f[nombreIdx]) continue;
          const umbRaw =
            umbIdx >= 0 && f[umbIdx]
              ? String(f[umbIdx]).toUpperCase()
              : undefined;
          productos.push({
            CODIGO: String(f[codIdx]),
            DESCRIPCION: String(f[nombreIdx]),
            UMB: this.resolverUmbSunat(umbRaw),
            COSTO_UNITARIO:
              costoSinIgvIdx >= 0 ? (f[costoSinIgvIdx] ?? 0) : 0,
            PRECIO_VENTA: precioIdx >= 0 ? (f[precioIdx] ?? 0) : 0,
            STOCK_INICIAL: invIdx >= 0 ? (f[invIdx] ?? 0) : 0,
            CATEGORIA: 'ETIQUETAS',
            AFECTACION: '10',
          });
        }
      }
    }

    // INVE. PT → PRODUCTO_FINAL (fila 0 es título, fila 1 son headers)
    const sheetPT = workbook.Sheets['INVE. PT'];
    if (sheetPT) {
      const filas = XLSX.utils.sheet_to_json(sheetPT, {
        header: 1,
      }) as any[][];
      const hIdx = buscarFilaHeaders(filas, ['COD.', 'NOMBRES']);
      if (hIdx >= 0) {
        const headers: any[] = filas[hIdx];
        const codIdx = headers.indexOf('COD.');
        const nombreIdx = headers.indexOf('NOMBRES');
        const costoUniIdx = headers.indexOf('COSTO UNI.');
        const costoIdx = headers.indexOf('COSTO');
        const umbIdx = headers.indexOf('UMB');
        const invIdx = headers.indexOf('Inventario');
        for (let i = hIdx + 1; i < filas.length; i++) {
          const f = filas[i];
          if (!f[codIdx] || !f[nombreIdx]) continue;
          const umbRaw =
            umbIdx >= 0 && f[umbIdx]
              ? String(f[umbIdx]).toUpperCase()
              : undefined;
          productos.push({
            CODIGO: String(f[codIdx]),
            DESCRIPCION: String(f[nombreIdx]),
            UMB: this.resolverUmbSunat(umbRaw),
            COSTO_UNITARIO:
              costoUniIdx >= 0 ? (f[costoUniIdx] ?? 0) : 0,
            PRECIO_VENTA: costoIdx >= 0 ? (f[costoIdx] ?? 0) : 0,
            STOCK_INICIAL: invIdx >= 0 ? (f[invIdx] ?? 0) : 0,
            CATEGORIA: 'PRODUCTO_TERMINADO',
            AFECTACION: '10',
          });
        }
      }
    }

    const seen = new Set<string>();
    return productos.filter((p) => {
      const cod = String(p['CODIGO'] ?? '').trim();
      if (!cod || seen.has(cod)) return false;
      seen.add(cod);
      return true;
    });
  }

  async importarPlantillaFabricacion(
    fileBuffer: Buffer,
    empresaId: number,
    usuarioId: number,
    sedeId?: number,
  ) {
    this.validarEmpresaId(empresaId);
    await this.asegurarRubroFabricacion(empresaId);

    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetProductos = workbook.Sheets['PRODUCTOS'];
    const sheetRecetas = workbook.Sheets['RECETAS'];
    const sheetOrdenes = workbook.Sheets['ORDENES'];

    let productosRows: Record<string, any>[];
    let recetasRows: Record<string, any>[];
    let ordenesRows: Record<string, any>[];

    if (sheetProductos && sheetRecetas) {
      productosRows = XLSX.utils.sheet_to_json(sheetProductos, { defval: null });
      recetasRows = XLSX.utils.sheet_to_json(sheetRecetas, { defval: null });
      ordenesRows = sheetOrdenes
        ? XLSX.utils.sheet_to_json(sheetOrdenes, { defval: null })
        : [];
    } else if (
      workbook.Sheets['INV.INSUM.'] ||
      workbook.Sheets['INV. ETIQ.'] ||
      workbook.Sheets['INVE. PT']
    ) {
      productosRows = this.leerProductosFormatoPersonalizado(workbook);
      recetasRows = [];
      ordenesRows = [];
    } else {
      throw new BadRequestException(
        'La plantilla debe contener las hojas PRODUCTOS y RECETAS (plantilla oficial) o las hojas INV.INSUM., INV. ETIQ. e INVE. PT.',
      );
    }

    const resumen = {
      productos: {
        total: productosRows.length,
        creados: 0,
        actualizados: 0,
        fallidos: 0,
        errores: [] as string[],
      },
      recetas: {
        total: 0,
        creadas: 0,
        actualizadas: 0,
        fallidas: 0,
        errores: [] as string[],
      },
      ordenes: {
        total: ordenesRows.length,
        creadas: 0,
        fallidas: 0,
        errores: [] as string[],
      },
    };

    const unidades = await this.prisma.unidadMedida.findMany({
      select: { id: true, codigo: true, nombre: true },
    });
    const unidadMap = new Map<string, number>();
    for (const unidad of unidades) {
      unidadMap.set(this.clavePlano(unidad.codigo), unidad.id);
      unidadMap.set(this.clavePlano(unidad.nombre), unidad.id);
    }

    const categoriasIniciales = await this.prisma.categoria.findMany({
      where: { empresaId },
      select: { id: true, nombre: true },
    });
    const categoriaMap = new Map<string, number>();
    for (const cat of categoriasIniciales) {
      categoriaMap.set(this.clavePlano(cat.nombre), cat.id);
    }

    const marcasIniciales = await this.prisma.marca.findMany({
      where: { empresaId },
      select: { id: true, nombre: true },
    });
    const marcaMap = new Map<string, number>();
    for (const marca of marcasIniciales) {
      marcaMap.set(this.clavePlano(marca.nombre), marca.id);
    }

    const resolverCategoriaId = async (nombre: string) => {
      const key = this.clavePlano(nombre);
      if (!key) return undefined;
      const existing = categoriaMap.get(key);
      if (existing) return existing;
      const creada = await this.prisma.categoria.create({
        data: { nombre: this.textoPlano(nombre), empresaId },
        select: { id: true, nombre: true },
      });
      categoriaMap.set(this.clavePlano(creada.nombre), creada.id);
      return creada.id;
    };

    const resolverMarcaId = async (nombre: string) => {
      const key = this.clavePlano(nombre);
      if (!key) return undefined;
      const existing = marcaMap.get(key);
      if (existing) return existing;
      const creada = await this.prisma.marca.create({
        data: { nombre: this.textoPlano(nombre), empresaId },
        select: { id: true, nombre: true },
      });
      marcaMap.set(this.clavePlano(creada.nombre), creada.id);
      return creada.id;
    };

    const tiposAfectacion = new Set(['10', '20', '30', '40']);

    for (let index = 0; index < productosRows.length; index++) {
      const row = productosRows[index];
      const fila = index + 2;
      try {
        const codigo = this.textoPlano(
          this.valorFila(row, ['CODIGO', 'Código', 'codigo']),
        );
        const descripcion = this.textoPlano(
          this.valorFila(row, ['DESCRIPCION', 'Descripción', 'descripcion']),
        );
        const unidadRaw = this.textoPlano(
          this.valorFila(row, ['UMB', 'UNIDAD_MEDIDA', 'Unidad', 'U.M']),
        );
        if (!codigo || !descripcion || !unidadRaw) {
          throw new BadRequestException(
            `Fila PRODUCTOS ${fila}: CODIGO, DESCRIPCION y UMB son obligatorios.`,
          );
        }

        const unidadId = this.resolverUnidadId(unidadRaw, unidadMap);
        if (!unidadId) {
          throw new BadRequestException(
            `Fila PRODUCTOS ${fila}: unidad ${unidadRaw} no existe en catálogo.`,
          );
        }

        const categoriaNombre = this.textoPlano(
          this.valorFila(row, ['CATEGORIA', 'Categoría', 'categoria']),
        );
        const marcaNombre = this.textoPlano(
          this.valorFila(row, ['MARCA', 'Marca', 'marca']),
        );
        const categoriaId = categoriaNombre
          ? await resolverCategoriaId(categoriaNombre)
          : undefined;
        const marcaId = marcaNombre
          ? await resolverMarcaId(marcaNombre)
          : undefined;

        const precioVenta = this.numeroSeguro(
          this.valorFila(row, ['PRECIO_VENTA', 'PRECIO', 'Precio']),
          0,
        );
        const costoUnitario = this.numeroSeguro(
          this.valorFila(row, ['COSTO_UNITARIO', 'COSTO', 'Costo']),
          0,
        );
        const stockInicial = Math.max(
          0,
          Math.round(
            this.numeroSeguro(
              this.valorFila(row, ['STOCK_INICIAL', 'STOCK', 'Inventario']),
              0,
            ),
          ),
        );
        const tipoAfectacionRaw = this.textoPlano(
          this.valorFila(row, ['AFECTACION', 'AFECT', 'IGV']),
        );
        const tipoAfectacion = tiposAfectacion.has(tipoAfectacionRaw)
          ? tipoAfectacionRaw
          : '10';
        const codigoBarras = this.textoPlano(
          this.valorFila(row, ['CODIGO_BARRAS', 'CODIGOBARRAS', 'BARRAS']),
        );

        const productoExistente = await this.prisma.producto.findFirst({
          where: { empresaId, codigo },
          select: { id: true, estado: true },
        });

        if (productoExistente && productoExistente.estado !== 'PLACEHOLDER') {
          await this.prisma.producto.update({
            where: { id: productoExistente.id },
            data: {
              descripcion,
              unidadMedidaId: unidadId,
              tipoAfectacionIGV: tipoAfectacion,
              precioUnitario: new Decimal(precioVenta),
              valorUnitario: new Decimal(
                Number((precioVenta / 1.18).toFixed(2)),
              ),
              costoPromedio: new Decimal(costoUnitario),
              categoriaId: categoriaId ?? null,
              marcaId: marcaId ?? null,
              codigoBarras: codigoBarras || null,
            },
          });
          resumen.productos.actualizados += 1;
          continue;
        }

        const creado = await this.productoService.crear(
          {
            codigo,
            descripcion,
            unidadMedidaId: unidadId,
            tipoAfectacionIGV: tipoAfectacion,
            precioUnitario: precioVenta,
            stock: stockInicial,
            categoriaId,
            marcaId,
            codigoBarras: codigoBarras || undefined,
          },
          empresaId,
          sedeId,
        );

        if (costoUnitario > 0) {
          await this.prisma.producto.update({
            where: { id: creado.id },
            data: { costoPromedio: new Decimal(costoUnitario) },
          });
        }

        resumen.productos.creados += 1;
      } catch (error: any) {
        resumen.productos.fallidos += 1;
        resumen.productos.errores.push(
          error?.response?.message || error?.message || `Error en fila ${fila}`,
        );
      }
    }

    const recetasAgrupadas = new Map<
      string,
      {
        codigo: string;
        nombre: string;
        version: number;
        productoFinalCodigo: string;
        rendimientoObjetivo: number;
        unidadRendimiento: string;
        mermaObjetivoPorcentaje: number;
        componentes: Array<{
          insumoCodigo: string;
          cantidadBase: number;
          unidadBase: string;
          orden: number;
        }>;
      }
    >();

    for (let index = 0; index < recetasRows.length; index++) {
      const row = recetasRows[index];
      const fila = index + 2;
      const recetaCodigo = this.textoPlano(
        this.valorFila(row, ['RECETA_CODIGO', 'CODIGO_RECETA', 'RECETA']),
      );
      const productoFinalCodigo = this.textoPlano(
        this.valorFila(row, ['PRODUCTO_FINAL_CODIGO', 'PRODUCTO_FINAL']),
      );
      const insumoCodigo = this.textoPlano(
        this.valorFila(row, ['INSUMO_CODIGO', 'COMPONENTE_CODIGO', 'INSUMO']),
      );
      const cantidadBase = this.numeroSeguro(
        this.valorFila(row, ['CANTIDAD_BASE', 'CANTIDAD', 'BASE']),
        0,
      );

      if (!recetaCodigo && !productoFinalCodigo && !insumoCodigo && !cantidadBase) {
        continue;
      }
      if (!recetaCodigo || !productoFinalCodigo || !insumoCodigo || cantidadBase <= 0) {
        resumen.recetas.fallidas += 1;
        resumen.recetas.errores.push(
          `Fila RECETAS ${fila}: RECETA_CODIGO, PRODUCTO_FINAL_CODIGO, INSUMO_CODIGO y CANTIDAD_BASE son obligatorios.`,
        );
        continue;
      }

      const version = Math.max(
        1,
        Math.round(this.numeroSeguro(this.valorFila(row, ['RECETA_VERSION', 'VERSION']), 1)),
      );
      const key = `${recetaCodigo}__${version}`;
      const existente = recetasAgrupadas.get(key);
      if (!existente) {
        recetasAgrupadas.set(key, {
          codigo: recetaCodigo,
          nombre:
            this.textoPlano(
              this.valorFila(row, ['RECETA_NOMBRE', 'NOMBRE_RECETA', 'NOMBRE']),
            ) || recetaCodigo,
          version,
          productoFinalCodigo,
          rendimientoObjetivo: this.numeroSeguro(
            this.valorFila(row, ['RENDIMIENTO_OBJETIVO', 'RENDIMIENTO']),
            1,
          ),
          unidadRendimiento:
            this.textoPlano(
              this.valorFila(row, ['UMB_RENDIMIENTO', 'UNIDAD_RENDIMIENTO']),
            ) || 'UN',
          mermaObjetivoPorcentaje: this.numeroSeguro(
            this.valorFila(row, ['MERMA_OBJETIVO_PORCENTAJE', 'MERMA_%']),
            0,
          ),
          componentes: [],
        });
      }

      const receta = recetasAgrupadas.get(key)!;
      receta.componentes.push({
        insumoCodigo,
        cantidadBase,
        unidadBase:
          this.textoPlano(this.valorFila(row, ['UMB_BASE', 'UNIDAD_BASE'])) ||
          'UN',
        orden: Math.max(
          1,
          Math.round(this.numeroSeguro(this.valorFila(row, ['ORDEN']), receta.componentes.length + 1)),
        ),
      });
    }

    resumen.recetas.total = recetasAgrupadas.size;

    if (recetasAgrupadas.size > 0) {
      const codigosProductos = new Set<string>();
      recetasAgrupadas.forEach((receta) => {
        codigosProductos.add(receta.productoFinalCodigo);
        receta.componentes.forEach((comp) => codigosProductos.add(comp.insumoCodigo));
      });

      const productosLookup = await this.prisma.producto.findMany({
        where: {
          empresaId,
          codigo: { in: Array.from(codigosProductos) },
          estado: { not: 'PLACEHOLDER' as any },
        },
        select: { id: true, codigo: true },
      });
      const productoPorCodigo = new Map<string, number>();
      for (const p of productosLookup) {
        productoPorCodigo.set(this.clavePlano(p.codigo), p.id);
      }

      for (const receta of recetasAgrupadas.values()) {
        try {
          const productoFinalId = productoPorCodigo.get(
            this.clavePlano(receta.productoFinalCodigo),
          );
          if (!productoFinalId) {
            throw new BadRequestException(
              `Receta ${receta.codigo}: producto final ${receta.productoFinalCodigo} no existe.`,
            );
          }

          const componentesDto = receta.componentes.map((comp) => {
            const productoInsumoId = productoPorCodigo.get(
              this.clavePlano(comp.insumoCodigo),
            );
            if (!productoInsumoId) {
              throw new BadRequestException(
                `Receta ${receta.codigo}: insumo ${comp.insumoCodigo} no existe.`,
              );
            }
            return {
              productoInsumoId,
              cantidadBase: comp.cantidadBase,
              unidadBase: comp.unidadBase,
              orden: comp.orden,
            };
          });

          const dto = {
            productoFinalId,
            codigo: receta.codigo,
            nombre: receta.nombre,
            version: receta.version,
            rendimientoObjetivo: receta.rendimientoObjetivo,
            unidadRendimiento: receta.unidadRendimiento,
            mermaObjetivoPorcentaje: receta.mermaObjetivoPorcentaje,
            componentes: componentesDto,
          };

          const recetaExistente = await this.prisma.recetaProduccion.findFirst({
            where: { empresaId, codigo: receta.codigo, version: receta.version },
            select: { id: true },
          });

          if (recetaExistente) {
            await this.actualizarReceta(empresaId, recetaExistente.id, dto);
            resumen.recetas.actualizadas += 1;
          } else {
            await this.crearReceta(empresaId, dto);
            resumen.recetas.creadas += 1;
          }
        } catch (error: any) {
          resumen.recetas.fallidas += 1;
          resumen.recetas.errores.push(
            error?.response?.message || error?.message || `Error en receta ${receta.codigo}`,
          );
        }
      }
    }

    if (ordenesRows.length > 0) {
      const recetasDisponibles = await this.prisma.recetaProduccion.findMany({
        where: { empresaId, activo: true },
        select: { id: true, codigo: true, version: true },
      });
      const recetaPorCodigoVersion = new Map<string, number>();
      for (const receta of recetasDisponibles) {
        recetaPorCodigoVersion.set(
          `${this.clavePlano(receta.codigo)}__${receta.version}`,
          receta.id,
        );
      }

      for (let index = 0; index < ordenesRows.length; index++) {
        const row = ordenesRows[index];
        const fila = index + 2;
        try {
          const loteProduccion = this.textoPlano(
            this.valorFila(row, ['LOTE_PRODUCCION', 'LOTE']),
          );
          const recetaCodigo = this.textoPlano(
            this.valorFila(row, ['RECETA_CODIGO', 'RECETA']),
          );
          const recetaVersion = Math.max(
            1,
            Math.round(this.numeroSeguro(this.valorFila(row, ['RECETA_VERSION', 'VERSION']), 1)),
          );
          const cantidadObjetivo = this.numeroSeguro(
            this.valorFila(row, ['CANTIDAD_OBJETIVO', 'CANTIDAD']),
            0,
          );
          const fechaProgramada = this.fechaExcelAISO(
            this.valorFila(row, ['FECHA_PROGRAMADA', 'FECHA']),
          );
          const observaciones = this.textoPlano(
            this.valorFila(row, ['OBSERVACIONES', 'OBS']),
          );

          if (!loteProduccion && !recetaCodigo && !cantidadObjetivo) continue;
          if (!loteProduccion || !recetaCodigo || cantidadObjetivo <= 0) {
            throw new BadRequestException(
              `Fila ORDENES ${fila}: LOTE_PRODUCCION, RECETA_CODIGO y CANTIDAD_OBJETIVO son obligatorios.`,
            );
          }

          const recetaId = recetaPorCodigoVersion.get(
            `${this.clavePlano(recetaCodigo)}__${recetaVersion}`,
          );
          if (!recetaId) {
            throw new BadRequestException(
              `Fila ORDENES ${fila}: receta ${recetaCodigo} v${recetaVersion} no encontrada.`,
            );
          }

          await this.crearOrden(empresaId, {
            recetaId,
            loteProduccion,
            cantidadObjetivo,
            fechaProgramada,
            observaciones: observaciones || undefined,
            usuarioResponsableId: usuarioId,
          } as any);
          resumen.ordenes.creadas += 1;
        } catch (error: any) {
          resumen.ordenes.fallidas += 1;
          resumen.ordenes.errores.push(
            error?.response?.message || error?.message || `Error en orden fila ${fila}`,
          );
        }
      }
    }

    return resumen;
  }
}
