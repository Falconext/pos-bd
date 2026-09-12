import { num, round3 } from '../common/utils/stock';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma, EstadoReserva, EstadoType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { KardexService } from '../kardex/kardex.service';
import { DigemidService } from '../digemid/digemid.service';
import { sincronizarVariantes, type VarianteConfig } from './variantes.util';
import {
  esEan13Valido,
  generarEan13Alternativo,
  generarEan13DesdeProductoId,
} from './ean13.util';
import {
  esRubroComputo,
  obtenerPlantillaComputo,
} from './ficha-tecnica-computo';
import { esRubroMotos, obtenerPlantillaMotos } from './ficha-tecnica-vehiculo';
import {
  getMaxImagenesProducto,
  getMaxImagenesExtra,
} from '../common/utils/rubro-features';
import * as XLSX from 'xlsx';
import axios from 'axios';

@Injectable()
export class ProductoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => KardexService))
    private readonly kardexService: KardexService,
    private readonly s3: S3Service,
    private readonly digemidService: DigemidService,
  ) {}

  private esProductoServicio(atributosTecnicos?: Record<string, any> | null) {
    return (
      String(atributosTecnicos?.tipoProducto || '').toUpperCase() === 'SERVICIO'
    );
  }

  // ==================== DISPONIBILIDAD POR SEDE ====================
  //
  // El catálogo (Producto) es uno por empresa; `ProductoStock.visibleEnSede`
  // dice si el producto está DISPONIBLE en cada sede (aparece en su inventario
  // y en su POS). Dos modos por empresa (Empresa.catalogoPorSede):
  //   - compartido (default): un producto nuevo queda disponible en todas las
  //     sedes → comportamiento histórico, nada cambia para clientes actuales.
  //   - por sede: un producto nuevo queda disponible SOLO en la sede que lo
  //     crea/importa; a las demás se asigna a mano o al recibir stock (traslado,
  //     compra, ingreso de kardex).
  // Regla transversal: un producto sin fila ProductoStock para una sede (datos
  // legado) se considera disponible, igual que hoy.

  /** Catálogo independiente por sede (Empresa.catalogoPorSede). */
  private async usaCatalogoPorSede(empresaId: number): Promise<boolean> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { catalogoPorSede: true },
    });
    return Boolean(empresa?.catalogoPorSede);
  }

  /**
   * Resuelve en qué sedes queda disponible un producto recién creado.
   *   1) `sedesDisponibles` explícito del formulario. La sede que recibe stock
   *      inicial > 0 siempre queda incluida (no puede haber stock "invisible").
   *   2) Catálogo por sede → solo la sede que lo crea (o la principal).
   *   3) Catálogo compartido → todas.
   */
  resolverSedesDisponiblesIniciales(params: {
    sedes: { id: number }[];
    sedeConStock?: number | null;
    stockInicial: number;
    sedesDisponibles?: number[] | null;
    catalogoPorSede: boolean;
  }): Set<number> {
    const ids = params.sedes.map((s) => s.id);
    const disponibles = new Set<number>();
    if (Array.isArray(params.sedesDisponibles)) {
      for (const id of params.sedesDisponibles) {
        const n = Number(id);
        if (ids.includes(n)) disponibles.add(n);
      }
      if (
        params.sedeConStock != null &&
        params.stockInicial > 0 &&
        ids.includes(params.sedeConStock)
      ) {
        disponibles.add(params.sedeConStock);
      }
      // Sin ninguna sede marcada no tiene sentido: cae al criterio automático.
      if (disponibles.size > 0) return disponibles;
    }
    if (params.catalogoPorSede && params.sedeConStock != null) {
      if (ids.includes(params.sedeConStock)) {
        disponibles.add(params.sedeConStock);
        return disponibles;
      }
    }
    ids.forEach((id) => disponibles.add(id));
    return disponibles;
  }

  /**
   * Crea las filas ProductoStock de un producto nuevo (una por sede activa).
   * Solo la sede que crea el producto (o la principal) recibe el stock inicial;
   * las demás arrancan en 0 para que los traslados partan de valores reales.
   */
  private async inicializarStockPorSede(params: {
    productoId: number;
    empresaId: number;
    sedeId?: number | null;
    esServicio: boolean;
    stock?: number | null;
    stockMinimo?: number | null;
    stockMaximo?: number | null;
    visibleEnSede?: boolean;
    vendibleEnSede?: boolean;
    precioUnitarioSede?: number | null;
    precioOfertaSede?: number | null;
    ubicacionSede?: string | null;
    sedesDisponibles?: number[] | null;
  }) {
    const sedes = await this.prisma.sede.findMany({
      where: { empresaId: params.empresaId, activo: true },
    });
    if (sedes.length === 0) return;
    const sedePrincipalId = sedes.find((s) => s.esPrincipal)?.id;
    // La sede que recibe el stock inicial: la del usuario actual, o la principal.
    const sedeConStock = params.sedeId ?? sedePrincipalId ?? null;
    const stockInicial = params.esServicio ? 0 : num(params.stock ?? 0);
    const disponibles = this.resolverSedesDisponiblesIniciales({
      sedes,
      sedeConStock,
      stockInicial,
      sedesDisponibles: params.sedesDisponibles,
      catalogoPorSede: await this.usaCatalogoPorSede(params.empresaId),
    });
    await this.prisma.productoStock.createMany({
      data: sedes.map((s) => {
        const esSedeCreadora = s.id === sedeConStock;
        return {
          productoId: params.productoId,
          sedeId: s.id,
          stock: esSedeCreadora ? stockInicial : 0,
          stockMinimo: params.stockMinimo ?? 0,
          stockMaximo: params.stockMaximo ?? null,
          visibleEnSede:
            disponibles.has(s.id) &&
            (esSedeCreadora ? (params.visibleEnSede ?? true) : true),
          vendibleEnSede: esSedeCreadora
            ? (params.vendibleEnSede ?? true)
            : true,
          precioUnitarioOverride:
            esSedeCreadora && params.precioUnitarioSede != null
              ? new Decimal(params.precioUnitarioSede)
              : null,
          precioOfertaOverride:
            esSedeCreadora && params.precioOfertaSede != null
              ? new Decimal(params.precioOfertaSede)
              : null,
          ubicacion: esSedeCreadora ? params.ubicacionSede || null : null,
        };
      }),
    });
  }

  /** Las variantes heredan la disponibilidad por sede del producto padre. */
  private async sincronizarDisponibilidadVariantes(padreId: number) {
    const variantes = await this.prisma.producto.findMany({
      where: { productoPadreId: padreId },
      select: { id: true },
    });
    if (variantes.length === 0) return;
    const stocksPadre = await this.prisma.productoStock.findMany({
      where: { productoId: padreId },
      select: { sedeId: true, visibleEnSede: true },
    });
    const ids = variantes.map((v) => v.id);
    for (const sp of stocksPadre) {
      await this.prisma.productoStock.updateMany({
        where: { productoId: { in: ids }, sedeId: sp.sedeId },
        data: { visibleEnSede: sp.visibleEnSede },
      });
    }
  }

  /** Marca el producto como disponible en la sede (crea la fila si no existe). */
  private async marcarDisponibleEnSede(productoId: number, sedeId: number) {
    await this.prisma.productoStock.upsert({
      where: { productoId_sedeId: { productoId, sedeId } },
      update: { visibleEnSede: true },
      create: {
        productoId,
        sedeId,
        stock: 0,
        stockMinimo: 0,
        visibleEnSede: true,
      },
    });
  }

  private parseImagenesExtra(value: unknown): string[] {
    if (Array.isArray(value))
      return value.filter(
        (url): url is string =>
          typeof url === 'string' && url.trim().length > 0,
      );
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter(
            (url): url is string =>
              typeof url === 'string' && url.trim().length > 0,
          )
        : [];
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }

  private async generarCodigoProducto(empresaId: number, prefijo = 'PR') {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, codigo: { startsWith: prefijo } },
      select: { codigo: true },
    });
    let maxNum = 0;
    const re = new RegExp(`^${prefijo}(\\d+)$`);
    for (const { codigo } of productos) {
      const m = codigo.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    const siguiente = maxNum + 1;
    return `${prefijo}${siguiente.toString().padStart(3, '0')}`;
  }

  private normalizarPorcentajes(
    porcentajeVenta?: number,
    porcentajeProvision?: number,
  ): { porcentajeVenta: number; porcentajeProvision: number } {
    const venta = Number.isFinite(porcentajeVenta as number)
      ? Number(porcentajeVenta)
      : undefined;
    const provision = Number.isFinite(porcentajeProvision as number)
      ? Number(porcentajeProvision)
      : undefined;

    if (venta !== undefined && (venta < 0 || venta > 100)) {
      throw new ForbiddenException(
        'El porcentaje de venta debe estar entre 0 y 100',
      );
    }
    if (provision !== undefined && (provision < 0 || provision > 100)) {
      throw new ForbiddenException(
        'El porcentaje de provisión debe estar entre 0 y 100',
      );
    }

    if (venta !== undefined && provision !== undefined) {
      if (venta + provision !== 100) {
        throw new ForbiddenException(
          'La suma de porcentaje de venta y provisión debe ser 100',
        );
      }
      return { porcentajeVenta: venta, porcentajeProvision: provision };
    }

    if (venta !== undefined) {
      return { porcentajeVenta: venta, porcentajeProvision: 100 - venta };
    }
    if (provision !== undefined) {
      return {
        porcentajeVenta: 100 - provision,
        porcentajeProvision: provision,
      };
    }

    return { porcentajeVenta: 100, porcentajeProvision: 0 };
  }

  async crear(
    data: {
      codigo?: string;
      descripcion: string;
      unidadMedidaId?: number;
      tipoAfectacionIGV: string;
      moneda?: string;
      precioUnitario: number;
      igvPorcentaje?: number;
      stock: number;
      categoriaId?: number;
      marcaId?: number;
      stockMinimo?: number;
      stockMaximo?: number;
      imagenUrl?: string;
      localizacion?: string;
      porcentajeVenta?: number;
      porcentajeProvision?: number;
      // Campos Farmacia
      principioActivo?: string;
      concentracion?: string;
      presentacion?: string;
      laboratorio?: string;
      requiereReceta?: boolean;
      controlado?: boolean;
      refrigerado?: boolean;
      unidadCompra?: string;
      unidadVenta?: string;
      factorConversion?: number | string;
      codigoBarras?: string;
      codigosBarrasExtra?: Array<
        | string
        | {
            codigo: string;
            unidadesPorPaquete?: number;
            precioPaquete?: number;
            alias?: string;
            codigoInterno?: string;
            imagenUrl?: string;
          }
      >;
      codigoDigemid?: string;
      codProdSunat?: string;
      costoUnitario?: number;
      costoPromedio?: number;
      costoFijo?: number;
      comisionPorVenta?: number;
      comisionPorcentaje?: number;
      // Campos Ofertas
      precioOferta?: number;
      fechaInicioOferta?: string | Date;
      fechaFinOferta?: string | Date;
      preciosMayorista?: { cantidadMinima: number; precio: number }[];
      atributosTecnicos?: Record<string, any> | null;
      descripcionLarga?: string;
      opcionesAtributos?: any;
      valoresAtributos?: any;
      productoPadreId?: number;
      variantesConfig?: VarianteConfig[];
      publicarEnTienda?: boolean;
      visibleEnSede?: boolean;
      vendibleEnSede?: boolean;
      precioUnitarioSede?: number | null;
      precioOfertaSede?: number | null;
      ubicacionSede?: string | null;
      /** Sedes donde queda disponible (ids). Si no viene, aplica el modo de la empresa. */
      sedesDisponibles?: number[] | null;
    },
    empresaId: number,
    sedeId?: number,
  ) {
    let {
      codigo,
      descripcion,
      unidadMedidaId,
      tipoAfectacionIGV,
      moneda,
      precioUnitario,
      igvPorcentaje = 18,
      stock,
      categoriaId,
      marcaId,
      stockMinimo,
      stockMaximo,
      imagenUrl,
      localizacion,
      porcentajeVenta,
      porcentajeProvision,
      // Farmacia/Otros
      principioActivo,
      concentracion,
      presentacion,
      laboratorio,
      requiereReceta,
      controlado,
      refrigerado,
      unidadCompra,
      unidadVenta,
      factorConversion,
      codigoBarras,
      codigoDigemid,
      codProdSunat,
      costoUnitario,
      costoPromedio,
      costoFijo,
      comisionPorVenta,
      comisionPorcentaje,
      precioOferta,
      fechaInicioOferta,
      fechaFinOferta,
      preciosMayorista,
      atributosTecnicos,
      descripcionLarga,
      publicarEnTienda,
      visibleEnSede,
      vendibleEnSede,
      precioUnitarioSede,
      precioOfertaSede,
      ubicacionSede,
    } = data;

    const porcentajes = this.normalizarPorcentajes(
      porcentajeVenta,
      porcentajeProvision,
    );
    const esServicio = this.esProductoServicio(atributosTecnicos);
    if (esServicio) {
      stock = 0;
      stockMinimo = 0;
      stockMaximo = 0;
    }

    if (!codigo) {
      codigo = await this.generarCodigoProducto(empresaId, 'PR');
    }

    // 1. Validar unicidad de SKU (codigo)
    const existe = await this.prisma.producto.findFirst({
      where: { codigo, empresaId },
    });

    // Validar si existe y no está eliminado
    if (existe && existe.estado !== 'PLACEHOLDER') {
      throw new ForbiddenException(
        `Ya existe un producto con ese código: "${existe.descripcion}". ` +
          'Si lo que quieres es venderlo en esta sede, asígnalo desde Inventario → Asignar a sede.',
      );
    }

    // 2. Validar unicidad de Código de Barras (si se proporciona) — contra el
    // código PRINCIPAL de otros productos y contra sus códigos ALTERNOS/de paquete.
    if (codigoBarras) {
      const existeBarras = await this.prisma.producto.findFirst({
        where: {
          empresaId,
          codigoBarras,
          estado: { not: 'PLACEHOLDER' as any },
        },
      });
      if (existeBarras) {
        throw new ForbiddenException(
          `El código de barras "${codigoBarras}" ya está asignado a otro producto: ${existeBarras.descripcion}`,
        );
      }
      const existeAlterno = await this.prisma.productoCodigoBarras.findFirst({
        where: { empresaId, codigo: codigoBarras },
        select: { producto: { select: { descripcion: true } } },
      });
      if (existeAlterno) {
        throw new ForbiddenException(
          `El código de barras "${codigoBarras}" ya está asignado a otro producto: ${existeAlterno.producto?.descripcion}`,
        );
      }
    }

    // Pre-validar códigos de barra adicionales ANTES de crear (evita productos huérfanos)
    if (data.codigosBarrasExtra !== undefined) {
      await this.validarColisionCodigosExtra(
        empresaId,
        this.normalizarCodigosExtra(data.codigosBarrasExtra, codigoBarras),
      );
    }

    if (!unidadMedidaId) {
      const niuUnidad = await this.prisma.unidadMedida.findFirst({
        where: { codigo: 'NIU' },
      });
      if (!niuUnidad)
        throw new ForbiddenException(
          'No se encontró unidad de medida por defecto',
        );
      unidadMedidaId = niuUnidad.id;
    }

    const unidad = await this.prisma.unidadMedida.findUnique({
      where: { id: unidadMedidaId },
    });
    if (!unidad) throw new ForbiddenException('Unidad de medida no válida');

    const tiposValidos = ['10', '20', '30', '40'];
    if (!tiposValidos.includes(tipoAfectacionIGV)) {
      throw new ForbiddenException('Tipo de afectación IGV no válido');
    }

    const divisor = 1 + igvPorcentaje / 100;
    const rawValor = precioUnitario / divisor;
    const valorUnitario = parseFloat(rawValor.toFixed(2));
    const costoBase = costoPromedio ?? costoUnitario;

    let nuevo;
    if (existe && existe.estado === 'PLACEHOLDER') {
      console.log(`[CREAR] Restaurando producto PLACEHOLDER: ${codigo}`);
      // Restaurar producto eliminado
      nuevo = await this.prisma.producto.update({
        where: { id: existe.id },
        data: {
          // Actualizamos con la nueva data
          descripcion,
          unidadMedidaId,
          tipoAfectacionIGV,
          moneda: moneda || 'PEN',
          precioUnitario: new Decimal(precioUnitario),
          valorUnitario: new Decimal(valorUnitario),
          igvPorcentaje: new Decimal(igvPorcentaje),
          stock,
          stockMinimo: stockMinimo != null ? stockMinimo : undefined,
          stockMaximo: stockMaximo != null ? stockMaximo : undefined,
          categoriaId:
            categoriaId && Number(categoriaId) > 0
              ? Number(categoriaId)
              : undefined,
          marcaId: marcaId && Number(marcaId) > 0 ? Number(marcaId) : undefined,
          imagenUrl: imagenUrl || undefined,
          localizacion: localizacion || undefined,
          porcentajeVenta: porcentajes.porcentajeVenta,
          porcentajeProvision: porcentajes.porcentajeProvision,
          estado: EstadoType.ACTIVO, // Reactivar usando Enum
          publicarEnTienda: publicarEnTienda ?? true,
          // Campos Farmacia update on restore
          principioActivo,
          concentracion,
          presentacion,
          laboratorio,
          requiereReceta: requiereReceta ?? undefined,
          controlado: controlado ?? undefined,
          refrigerado: refrigerado ?? undefined,
          unidadCompra,
          unidadVenta,
          factorConversion: factorConversion
            ? Number(factorConversion)
            : undefined,
          codigoBarras,
          codigoDigemid,
          codProdSunat,
          costoPromedio: costoBase != null ? new Decimal(costoBase) : undefined,
          costoFijo: costoFijo != null ? new Decimal(costoFijo) : undefined,
          comisionPorVenta:
            comisionPorVenta != null
              ? new Decimal(comisionPorVenta)
              : undefined,
          comisionPorcentaje:
            comisionPorcentaje != null
              ? new Decimal(comisionPorcentaje)
              : undefined,
          // Campos Ofertas — `null` explícito limpia la oferta; `undefined`/ausente la deja igual
          precioOferta:
            precioOferta === null
              ? null
              : precioOferta
                ? new Decimal(precioOferta)
                : undefined,
          fechaInicioOferta:
            fechaInicioOferta === null
              ? null
              : fechaInicioOferta
                ? new Date(fechaInicioOferta)
                : undefined,
          fechaFinOferta:
            fechaFinOferta === null
              ? null
              : fechaFinOferta
                ? new Date(fechaFinOferta)
                : undefined,
          preciosMayorista: preciosMayorista ?? undefined,
          atributosTecnicos: atributosTecnicos ?? undefined,
          opcionesAtributos: data.opcionesAtributos ?? undefined,
          valoresAtributos: data.valoresAtributos ?? undefined,
          productoPadreId: data.productoPadreId ?? undefined,
        },
      });

      // Un producto ELIMINADO conserva sus filas de stock por sede
      // (ProductoStock). Al restaurarlo como un alta nueva, ese stock viejo NO
      // debe heredarse — causaba stock "fantasma": al borrar productos y
      // reimportar un Excel, filas sin stock aparecían con el stock del
      // producto que antes tenía ese código. Se limpia y se re-inicializa con
      // el mismo criterio que un producto nuevo (stock inicial solo en la sede
      // que lo crea; las demás en 0).
      await this.prisma.productoStock.deleteMany({
        where: { productoId: existe.id },
      });
      await this.inicializarStockPorSede({
        productoId: existe.id,
        empresaId,
        sedeId,
        esServicio,
        stock,
        stockMinimo,
        stockMaximo,
        visibleEnSede,
        vendibleEnSede,
        precioUnitarioSede,
        precioOfertaSede,
        ubicacionSede,
        sedesDisponibles: data.sedesDisponibles,
      });
    } else {
      // Crear nuevo
      nuevo = await this.prisma.producto.create({
        data: {
          codigo,
          descripcion,
          unidadMedidaId,
          tipoAfectacionIGV,
          moneda: moneda || 'PEN',
          precioUnitario: new Decimal(precioUnitario),
          valorUnitario: new Decimal(valorUnitario),
          igvPorcentaje: new Decimal(igvPorcentaje),
          stock,
          stockMinimo: stockMinimo != null ? stockMinimo : undefined,
          stockMaximo: stockMaximo != null ? stockMaximo : undefined,
          categoriaId:
            categoriaId && Number(categoriaId) > 0
              ? Number(categoriaId)
              : undefined,
          marcaId: marcaId && Number(marcaId) > 0 ? Number(marcaId) : undefined,
          empresaId,
          imagenUrl: imagenUrl || undefined,
          localizacion: localizacion || undefined,
          porcentajeVenta: porcentajes.porcentajeVenta,
          porcentajeProvision: porcentajes.porcentajeProvision,
          estado: EstadoType.ACTIVO,
          publicarEnTienda: publicarEnTienda ?? true,
          // Campos Farmacia
          principioActivo,
          concentracion,
          presentacion,
          laboratorio,
          requiereReceta: requiereReceta ?? undefined,
          controlado: controlado ?? undefined,
          refrigerado: refrigerado ?? undefined,
          unidadCompra,
          unidadVenta,
          factorConversion: factorConversion ? Number(factorConversion) : 1,
          codigoBarras,
          codigoDigemid,
          codProdSunat,
          costoPromedio: costoBase != null ? new Decimal(costoBase) : undefined,
          costoFijo: costoFijo != null ? new Decimal(costoFijo) : undefined,
          comisionPorVenta:
            comisionPorVenta != null
              ? new Decimal(comisionPorVenta)
              : undefined,
          comisionPorcentaje:
            comisionPorcentaje != null
              ? new Decimal(comisionPorcentaje)
              : undefined,
          // Campos Ofertas — `null` explícito limpia la oferta; `undefined`/ausente la deja igual
          precioOferta:
            precioOferta === null
              ? null
              : precioOferta
                ? new Decimal(precioOferta)
                : undefined,
          fechaInicioOferta:
            fechaInicioOferta === null
              ? null
              : fechaInicioOferta
                ? new Date(fechaInicioOferta)
                : undefined,
          fechaFinOferta:
            fechaFinOferta === null
              ? null
              : fechaFinOferta
                ? new Date(fechaFinOferta)
                : undefined,
          preciosMayorista: preciosMayorista ?? undefined,
          atributosTecnicos: atributosTecnicos ?? undefined,
          opcionesAtributos: data.opcionesAtributos ?? undefined,
          valoresAtributos: data.valoresAtributos ?? undefined,
          productoPadreId: data.productoPadreId ?? undefined,
          descripcionLarga: descripcionLarga || undefined,
        },
      });

      // Inicializar el registro de stock por sede (stock inicial solo en la sede
      // que crea el producto; disponibilidad según el modo de catálogo).
      await this.inicializarStockPorSede({
        productoId: nuevo.id,
        empresaId,
        sedeId,
        esServicio,
        stock,
        stockMinimo,
        stockMaximo,
        visibleEnSede,
        vendibleEnSede,
        precioUnitarioSede,
        precioOfertaSede,
        ubicacionSede,
        sedesDisponibles: data.sedesDisponibles,
      });
    }

    if (nuevo.opcionesAtributos) {
      const sedesSync = await this.prisma.sede.findMany({
        where: { empresaId: empresaId, activo: true },
      });
      await sincronizarVariantes(
        this.prisma as any,
        nuevo,
        sedesSync,
        data.variantesConfig || [],
        sedeId,
      );
      await this.sincronizarDisponibilidadVariantes(nuevo.id);
    }

    await this.sincronizarCodigosBarrasExtra(
      nuevo.id,
      empresaId,
      data.codigosBarrasExtra,
      nuevo.codigoBarras,
    );

    return this.obtenerPorId(nuevo.id, empresaId);
  }

  /**
   * Carga los items de la lista de precio que aplica al usuario/sede, en un
   * Map keyed por `${productoId}|${presentacionCodigo}` ('' = unidad base).
   *
   * Modelo pensado para el empresario (intuitivo):
   *   1) Lista ESPECÍFICA del usuario  (precio especial de ese cajero/cliente)
   *   2) Lista ESPECÍFICA de la sede    (la excepción de ese local)
   *   3) Lista "por defecto" de la empresa (los precios normales del negocio)
   *   4) (si no hay) → precio base del producto, lo resuelve resolverPrecioConLista
   *
   * La lista "por defecto" NO compite en los pasos 1 y 2: es solo el fallback
   * general. Así, asignar al dueño/local a la lista general no lo "clava", y una
   * lista específica de un local SIEMPRE gana sobre la default.
   * Una sola query por listado (no por producto). Map vacío si no hay lista.
   */
  private async cargarItemsListaPrecio(
    empresaId: number,
    usuarioId?: number,
    sedeId?: number,
  ): Promise<
    Map<string, { precioUnitario: number; precioOferta: number | null }>
  > {
    const map = new Map<
      string,
      { precioUnitario: number; precioOferta: number | null }
    >();

    let lista: { items: any[] } | null = null;
    // 1) Lista específica del usuario (excluye la default: no debe "clavar").
    if (usuarioId) {
      lista = await this.prisma.listaPrecio.findFirst({
        where: {
          empresaId,
          activo: true,
          esPorDefecto: false,
          usuarios: { some: { usuarioId } },
        },
        orderBy: { id: 'asc' },
        include: { items: true },
      });
    }
    // 2) Lista específica de la sede (excluye la default).
    if (!lista && sedeId) {
      lista = await this.prisma.listaPrecio.findFirst({
        where: {
          empresaId,
          activo: true,
          esPorDefecto: false,
          sedes: { some: { sedeId } },
        },
        orderBy: { id: 'asc' },
        include: { items: true },
      });
    }
    // 3) Lista "por defecto" de la empresa: fallback general (precios normales).
    if (!lista) {
      lista = await this.prisma.listaPrecio.findFirst({
        where: { empresaId, activo: true, esPorDefecto: true },
        include: { items: true },
      });
    }
    if (lista) {
      for (const it of lista.items) {
        map.set(`${it.productoId}|${it.presentacionCodigo || ''}`, {
          precioUnitario: Number(it.precioUnitario),
          precioOferta:
            it.precioOferta != null ? Number(it.precioOferta) : null,
        });
      }
    }
    return map;
  }

  /**
   * Precio efectivo de venta con la precedencia completa:
   * lista de precio (usuario/sede) > override legado de ProductoStock >
   * precio base del producto. `itemsLista` ya viene filtrado por usuario/sede.
   */
  private resolverPrecioConLista(
    itemsLista: Map<
      string,
      { precioUnitario: number; precioOferta: number | null }
    >,
    productoId: number,
    presentacionCodigo: string,
    usarPrecioSede: boolean,
    overrideUnit: any,
    overrideOferta: any,
    baseUnit: number,
    baseOferta: number | null,
  ): { precioUnitario: number; precioOferta: number | null } {
    const desdeLista = itemsLista.get(`${productoId}|${presentacionCodigo}`);
    if (desdeLista) return desdeLista;
    const precioUnitario =
      usarPrecioSede && overrideUnit != null ? Number(overrideUnit) : baseUnit;
    const precioOferta =
      usarPrecioSede && overrideOferta != null
        ? Number(overrideOferta)
        : baseOferta;
    return { precioUnitario, precioOferta };
  }

  /** Campos donde se busca cada palabra de un término de producto. */
  private camposBusquedaProducto(term: string): any[] {
    return [
      { descripcion: { contains: term, mode: 'insensitive' } },
      { codigo: { contains: term, mode: 'insensitive' } },
      { principioActivo: { contains: term, mode: 'insensitive' } },
      { codigoBarras: { contains: term, mode: 'insensitive' } },
      { codigoDigemid: { contains: term, mode: 'insensitive' } },
      { laboratorio: { contains: term, mode: 'insensitive' } },
      {
        codigosBarras: {
          some: {
            OR: [
              { codigo: { contains: term, mode: 'insensitive' } },
              { alias: { contains: term, mode: 'insensitive' } },
              { codigoInterno: { contains: term, mode: 'insensitive' } },
            ],
          },
        },
      },
    ];
  }

  /**
   * Búsqueda flexible por palabras: divide el término en palabras y exige que
   * CADA palabra aparezca en algún campo (AND de tokens). Así "válvula tanque"
   * encuentra "Válvula de llenado de agua para tanque" sin escribir el nombre
   * completo ni respetar el orden. Devuelve el arreglo para `where.AND` (o
   * undefined si no hay término).
   */
  private busquedaPorPalabras(searchTerm?: string): any[] | undefined {
    const t = searchTerm?.trim();
    if (!t) return undefined;
    const palabras = t.split(/\s+/).filter(Boolean);
    return palabras.map((palabra) => ({
      OR: this.camposBusquedaProducto(palabra),
    }));
  }

  async listar(params: {
    empresaId: number;
    sedeId?: number;
    search?: string;
    page?: number;
    limit?: number;
    sort?: 'id' | 'descripcion' | 'codigo';
    order?: 'asc' | 'desc';
    marcaId?: number;
    categoriaId?: number;
    incluirVariantes?: string | boolean;
    soloVendibles?: boolean;
    usarPrecioSede?: boolean;
    usuarioId?: number;
    soloStockBajo?: boolean;
    priorizarStock?: boolean;
    /** Incluir productos NO disponibles en la sede (para asignarlos). */
    incluirOcultos?: boolean;
  }) {
    const {
      empresaId,
      search,
      page = 1,
      limit = 10,
      sort = 'id',
      order = 'desc',
      marcaId,
      categoriaId,
    } = params;
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;
    const skip = (pageNumber - 1) * limitNumber;

    // Códigos de productos del sistema que no deben mostrarse a los usuarios
    const productosDelSistema = ['PLD', 'IPM', 'DGD'];

    const searchTerm = search?.trim();

    const where: any = {
      empresaId,
      estado: { in: [EstadoType.ACTIVO, EstadoType.INACTIVO] },
      // Excluir productos del sistema (PENALIDAD, INTERES POR MORA, DESCUENTO GLOBAL)
      codigo: { notIn: productosDelSistema },
      marcaId: marcaId ? Number(marcaId) : undefined,
      categoriaId: categoriaId ? Number(categoriaId) : undefined,
    };

    // Búsqueda flexible por palabras (cada palabra debe aparecer en algún campo).
    const searchAnd = this.busquedaPorPalabras(searchTerm);
    if (searchAnd) where.AND = searchAnd;

    if (String(params.incluirVariantes) !== 'true') {
      where.productoPadreId = null;
    }

    if (params.sedeId && params.soloVendibles) {
      where.stocks = {
        some: {
          sedeId: params.sedeId,
          visibleEnSede: true,
          vendibleEnSede: true,
        },
      };
    } else if (params.sedeId && !params.incluirOcultos) {
      // Disponibilidad por sede: en el contexto de una sede se excluyen los
      // productos marcados como NO disponibles en ella. Un producto sin fila
      // ProductoStock para la sede (legado) sigue apareciendo, igual que antes.
      where.NOT = {
        stocks: { some: { sedeId: params.sedeId, visibleEnSede: false } },
      };
    }

    if (params.soloStockBajo) {
      // Pre-filter: only include products that have a stockMinimo configured > 0
      // (products without stockMinimo can never be "low stock").
      // Field-to-field comparison (stock <= stockMinimo) is not supported by Prisma,
      // so a JS post-filter is applied after computing effective stock values.
      where.AND = [...(where.AND ?? []), { stockMinimo: { gt: 0 } }];
    }

    // Prioriza productos con stock: los con stock (producto.stock = suma de sedes,
    // mantenida por kardex) van primero, y dentro de cada grupo se respeta el orden
    // pedido. Se activa solo con priorizarStock (ej. POS de facturación).
    const orderBy: any = params.priorizarStock
      ? [{ stock: 'desc' }, { [sort]: order }]
      : { [sort]: order };

    const [productosRaw, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy,
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          imagenUrl: true,
          stock: true, // Fallback cuando ProductoStock está vacío
          stockMinimo: true,
          stockMaximo: true,
          stocks: {
            where: {
              ...(params.sedeId ? { sedeId: params.sedeId } : {}),
            },
            select: {
              stock: true,
              stockMinimo: true,
              stockMaximo: true,
              sedeId: true,
              ubicacion: true,
              visibleEnSede: true,
              vendibleEnSede: true,
              precioUnitarioOverride: true,
              precioOfertaOverride: true,
            },
          },
          costoPromedio: true,
          costoFijo: true,
          comisionPorVenta: true,
          comisionPorcentaje: true,
          precioUnitario: true,
          moneda: true,
          precioOferta: true,
          fechaInicioOferta: true,
          fechaFinOferta: true,
          valorUnitario: true,
          igvPorcentaje: true,
          tipoAfectacionIGV: true,
          estado: true,
          localizacion: true,
          porcentajeVenta: true,
          porcentajeProvision: true,
          categoriaId: true,
          unidadMedidaId: true,
          marcaId: true,
          empresaId: true,
          creadoEn: true,
          preciosMayorista: true,
          atributosTecnicos: true,
          codigoBarras: true,
          // Códigos de PAQUETE (ej. six-pack): el POS los muestra como tarjetas
          // propias del catálogo, además de responder al escaneo.
          codigosBarras: {
            where: { unidadesPorPaquete: { gt: 1 } },
            select: {
              codigo: true,
              unidadesPorPaquete: true,
              precioPaquete: true,
              alias: true,
              codigoInterno: true,
              imagenUrl: true,
            },
          },
          codigoDigemid: true,
          codProdSunat: true,
          requiereReceta: true,
          controlado: true,
          refrigerado: true,
          principioActivo: true,
          concentracion: true,
          presentacion: true,
          laboratorio: true,
          factorConversion: true,
          unidadCompra: true,
          unidadVenta: true,
          descripcionLarga: true,
          publicarEnTienda: true,
          productoPadreId: true,
          opcionesAtributos: true,
          valoresAtributos: true,
          variantes: {
            where: { estado: { in: [EstadoType.ACTIVO, EstadoType.INACTIVO] } },
            select: {
              id: true,
              codigo: true,
              descripcion: true,
              precioUnitario: true,
              moneda: true,
              precioOferta: true,
              stock: true,
              estado: true,
              valoresAtributos: true,
              imagenUrl: true,
              codigoBarras: true,
              stocks: {
                where: {
                  ...(params.sedeId ? { sedeId: params.sedeId } : {}),
                },
                select: {
                  stock: true,
                  sedeId: true,
                  visibleEnSede: true,
                  vendibleEnSede: true,
                  precioUnitarioOverride: true,
                  precioOfertaOverride: true,
                },
              },
            },
          },
          unidadMedida: {
            select: {
              id: true,
              codigo: true,
              nombre: true,
            },
          },
          categoria: {
            select: {
              id: true,
              nombre: true,
            },
          },
          marca: {
            select: {
              id: true,
              nombre: true,
            },
          },
          lotes: {
            where: {
              activo: true,
              stockActual: { gt: 0 },
            },
            select: {
              lote: true,
              fechaVencimiento: true,
              stockActual: true,
              costoUnitario: true,
            },
            orderBy: {
              fechaVencimiento: 'asc',
            },
          },
        },
      }),
      this.prisma.producto.count({ where }),
    ]);

    const productoIds = productosRaw.map((p) => p.id);
    const reservasAgrupadas =
      productoIds.length > 0
        ? await this.prisma.reserva.groupBy({
            by: ['productoId'],
            where: {
              empresaId,
              ...(params.sedeId ? { sedeId: params.sedeId } : {}),
              productoId: { in: productoIds },
              estado: {
                in: [EstadoReserva.PENDIENTE, EstadoReserva.CONFIRMADA],
              },
            },
            _sum: { cantidad: true },
          })
        : [];
    const reservadoPorProducto = new Map<number, number>(
      reservasAgrupadas.map((r) => [r.productoId, r._sum.cantidad ?? 0]),
    );

    // Lista de precios que aplica al usuario/sede (solo en contexto de venta,
    // igual que el override por sede). Una sola query para todo el listado.
    const itemsLista = params.usarPrecioSede
      ? await this.cargarItemsListaPrecio(
          empresaId,
          params.usuarioId,
          params.sedeId,
        )
      : new Map<
          string,
          { precioUnitario: number; precioOferta: number | null }
        >();

    // Firmar imagenes si son de S3
    const normalizePersistentImageUrl = (url?: string | null) => {
      if (!url) return url as any;
      return url.includes('amazonaws.com/') ? url.split('?')[0] : url;
    };

    const signIfS3 = async (url?: string | null) => {
      try {
        const persistentUrl = normalizePersistentImageUrl(url);
        if (!persistentUrl) return persistentUrl;
        const idx = persistentUrl.indexOf('amazonaws.com/');
        if (idx === -1) return persistentUrl;
        const key = persistentUrl.substring(idx + 'amazonaws.com/'.length);
        if (!key) return persistentUrl;
        const signed = await this.s3.getSignedGetUrl(key, 600);
        return signed || persistentUrl;
      } catch {
        return url as any;
      }
    };

    const productos = await Promise.all(
      productosRaw.map(async (p) => {
        const stockDesdeLotes = (p.lotes || []).reduce(
          (acc, lote) => acc + Number(lote.stockActual || 0),
          0,
        );
        const usaStockLotes = stockDesdeLotes > 0;
        const loteFefoActual = usaStockLotes ? p.lotes[0] : null;

        // Si se pide una sede específica, usar SOLO ese stock.
        // Si no se pide sede, usar suma total como comportamiento histórico.
        const stockTotalBase = params.sedeId
          ? num(p.stocks[0]?.stock) // if sedeId is specific, and no ProductoStock exists, stock is 0
          : p.stocks.length > 0
            ? p.stocks.reduce((sum, s) => sum + num(s.stock), 0)
            : num((p as any).stock);
        // If a specific sede is requested, we MUST use the sede's specific stock from ProductoStock (stockTotalBase).
        // Lotes don't have sedeId in this schema, so their sum is global.
        const stockTotal =
          usaStockLotes && !params.sedeId ? stockDesdeLotes : stockTotalBase;
        const stockMinimo = params.sedeId
          ? (p.stocks[0]?.stockMinimo ?? 0)
          : p.stocks.length > 0
            ? p.stocks.reduce((sum, s) => sum + (s.stockMinimo || 0), 0)
            : ((p as any).stockMinimo ?? 0);
        const stockSede = params.sedeId
          ? (p.stocks[0] as any | undefined)
          : undefined;
        const {
          precioUnitario: precioUnitarioEfectivo,
          precioOferta: precioOfertaEfectivo,
        } = this.resolverPrecioConLista(
          itemsLista,
          p.id,
          '',
          !!params.usarPrecioSede,
          stockSede?.precioUnitarioOverride,
          stockSede?.precioOfertaOverride,
          Number(p.precioUnitario),
          p.precioOferta != null ? Number(p.precioOferta) : null,
        );
        const reservado = reservadoPorProducto.get(p.id) ?? 0;
        const cupoProvision = Math.floor(
          (stockTotal * (p.porcentajeProvision ?? 0)) / 100,
        );
        const cupoVenta = Math.max(0, stockTotal - cupoProvision);
        const stockDisponibleVenta = Math.max(
          0,
          Math.min(stockTotal - reservado, cupoVenta),
        );

        const imagenUrl = normalizePersistentImageUrl(
          (p as any).imagenUrl as string | null,
        );
        const variantes = await Promise.all(
          ((p as any).variantes || []).map(async (variante: any) => {
            const varianteImagenUrl = normalizePersistentImageUrl(
              variante.imagenUrl as string | null,
            );
            const varianteStock = params.sedeId
              ? (variante.stocks?.[0]?.stock ?? 0)
              : Array.isArray(variante.stocks) && variante.stocks.length > 0
                ? variante.stocks.reduce(
                    (sum: number, stockRow: any) =>
                      sum + Number(stockRow.stock || 0),
                    0,
                  )
                : Number(variante.stock || 0);
            const varianteStockSede = params.sedeId
              ? variante.stocks?.[0]
              : undefined;
            const {
              precioUnitario: variantePrecioUnitario,
              precioOferta: variantePrecioOferta,
            } = this.resolverPrecioConLista(
              itemsLista,
              variante.id,
              '',
              !!params.usarPrecioSede,
              varianteStockSede?.precioUnitarioOverride,
              varianteStockSede?.precioOfertaOverride,
              Number(variante.precioUnitario),
              variante.precioOferta != null
                ? Number(variante.precioOferta)
                : null,
            );

            return {
              ...variante,
              stock: varianteStock,
              precioUnitario: variantePrecioUnitario,
              precioOferta: variantePrecioOferta,
              sedeStockConfig: varianteStockSede
                ? {
                    sedeId: varianteStockSede.sedeId,
                    visibleEnSede: varianteStockSede.visibleEnSede,
                    vendibleEnSede: varianteStockSede.vendibleEnSede,
                    precioUnitarioSede:
                      varianteStockSede.precioUnitarioOverride != null
                        ? Number(varianteStockSede.precioUnitarioOverride)
                        : null,
                    precioOfertaSede:
                      varianteStockSede.precioOfertaOverride != null
                        ? Number(varianteStockSede.precioOfertaOverride)
                        : null,
                  }
                : null,
              imagenUrl: varianteImagenUrl,
              imagenUrlDisplay: await signIfS3(varianteImagenUrl),
            };
          }),
        );

        return {
          ...p,
          variantes,
          precioUnitario: precioUnitarioEfectivo,
          precioOferta: precioOfertaEfectivo,
          stock: stockDisponibleVenta,
          stockBase: stockTotal,
          stockReservado: reservado,
          stockDisponibleVenta,
          stockMinimo: stockMinimo,
          stockMaximo: stockSede?.stockMaximo ?? (p as any).stockMaximo ?? null,
          // Disponible en la sede consultada (sin sede = catálogo completo).
          disponibleEnSede: stockSede
            ? stockSede.visibleEnSede !== false
            : true,
          sedeStockConfig: stockSede
            ? {
                sedeId: stockSede.sedeId,
                stock: stockSede.stock,
                stockMinimo: stockSede.stockMinimo ?? 0,
                stockMaximo: stockSede.stockMaximo ?? null,
                ubicacionSede: stockSede.ubicacion ?? null,
                visibleEnSede: stockSede.visibleEnSede,
                vendibleEnSede: stockSede.vendibleEnSede,
                precioUnitarioSede:
                  stockSede.precioUnitarioOverride != null
                    ? Number(stockSede.precioUnitarioOverride)
                    : null,
                precioOfertaSede:
                  stockSede.precioOfertaOverride != null
                    ? Number(stockSede.precioOfertaOverride)
                    : null,
              }
            : null,
          costoUnitario: Number(p.costoPromedio) || 0,
          costoFijo: Number((p as any).costoFijo) || 0,
          comisionPorVenta: Number((p as any).comisionPorVenta) || 0,
          comisionPorcentaje: Number((p as any).comisionPorcentaje) || 0,
          loteFefoCodigo: loteFefoActual?.lote || null,
          loteFefoVencimiento: loteFefoActual?.fechaVencimiento || null,
          loteFefoCostoUnitario: loteFefoActual?.costoUnitario
            ? Number(loteFefoActual.costoUnitario)
            : null,
          imagenUrl,
          imagenUrlDisplay: await signIfS3(imagenUrl),
          // Paquetes (códigos alternos con unidadesPorPaquete > 1), con la
          // imagen firmada para que el POS pueda pintar la tarjeta del pack.
          paquetes: await Promise.all(
            (((p as any).codigosBarras as any[]) || []).map(async (c: any) => {
              // Precio del paquete: si la lista de precio define un precio para
              // esta presentación (código), gana sobre el precioPaquete base.
              const desdeLista = itemsLista.get(`${p.id}|${c.codigo}`);
              const precioPaquete = desdeLista
                ? desdeLista.precioUnitario
                : c.precioPaquete != null
                  ? Number(c.precioPaquete)
                  : null;
              return {
                codigo: c.codigo,
                codigoInterno: c.codigoInterno || null,
                unidadesPorPaquete: Number(c.unidadesPorPaquete) || 1,
                precioPaquete,
                alias: c.alias || null,
                imagenUrl: c.imagenUrl || null,
                imagenUrlDisplay: await signIfS3(
                  normalizePersistentImageUrl(c.imagenUrl),
                ),
              };
            }),
          ),
        };
      }),
    );

    // Post-filter for soloStockBajo: keep only products where effective stock <= stockMinimo.
    // Prisma can't express column-to-column comparison natively, so we filter in JS
    // after computing the effective stock values.
    const productosFinales = params.soloStockBajo
      ? productos.filter((p: any) => {
          const stockEfectivo = Number(p.stock ?? 0);
          const minimo = Number(p.stockMinimo ?? 0);
          return minimo > 0 && stockEfectivo <= minimo;
        })
      : productos;

    return {
      productos: productosFinales,
      total: params.soloStockBajo ? productosFinales.length : total,
      page,
      limit,
    };
  }

  async resumen(params: {
    empresaId: number;
    sedeId?: number;
    search?: string;
    marcaId?: number;
    categoriaId?: number;
  }) {
    const { empresaId, marcaId, categoriaId } = params;
    const productosDelSistema = ['PLD', 'IPM', 'DGD'];
    const searchTerm = params.search?.trim();

    const where: any = {
      empresaId,
      estado: { in: [EstadoType.ACTIVO, EstadoType.INACTIVO] },
      codigo: { notIn: productosDelSistema },
      productoPadreId: null,
      marcaId: marcaId ? Number(marcaId) : undefined,
      categoriaId: categoriaId ? Number(categoriaId) : undefined,
    };

    // Búsqueda flexible por palabras (misma lógica que `listar`).
    const searchAnd = this.busquedaPorPalabras(searchTerm);
    if (searchAnd) where.AND = searchAnd;
    // Misma regla de disponibilidad por sede que `listar`.
    if (params.sedeId) {
      where.NOT = {
        stocks: { some: { sedeId: params.sedeId, visibleEnSede: false } },
      };
    }

    const [totalProductos, productos] = await Promise.all([
      this.prisma.producto.count({ where }),
      this.prisma.producto.findMany({
        where,
        select: {
          stock: true,
          costoPromedio: true,
          tipoAfectacionIGV: true,
          atributosTecnicos: true,
          stocks: {
            where: {
              ...(params.sedeId ? { sedeId: params.sedeId } : {}),
            },
            select: { stock: true },
          },
          lotes: {
            where: { activo: true, stockActual: { gt: 0 } },
            select: { stockActual: true },
          },
        },
      }),
    ]);

    let totalCantidad = 0;
    let totalValorInventario = 0;

    for (const p of productos) {
      if (this.esProductoServicio((p as any).atributosTecnicos)) continue;

      const stockDesdeLotes = (p.lotes || []).reduce(
        (acc, lote) => acc + Number(lote.stockActual || 0),
        0,
      );
      const usaStockLotes = stockDesdeLotes > 0;
      const stockTotalBase = params.sedeId
        ? num(p.stocks[0]?.stock)
        : p.stocks.length > 0
          ? p.stocks.reduce((sum, s) => sum + num(s.stock), 0)
          : num((p as any).stock);
      const stockTotal =
        usaStockLotes && !params.sedeId ? stockDesdeLotes : stockTotalBase;
      // Costo "de bolsillo" (CON IGV) — misma regla que la columna Costo de la
      // tabla de productos del frontend, para que el KPI calce con lo listado
      // (costoPromedio se guarda NETO; se re-agrega el IGV si es gravado).
      const costoNeto = Number(p.costoPromedio) || 0;
      const esGravado = String((p as any).tipoAfectacionIGV ?? '10') === '10';
      const costo = esGravado
        ? parseFloat((costoNeto * 1.18).toFixed(2))
        : costoNeto;

      totalCantidad += stockTotal;
      totalValorInventario += stockTotal * costo;
    }

    return { totalProductos, totalCantidad, totalValorInventario };
  }

  /**
   * Catálogo optimizado para POS de farmacia / botica / droguería.
   * Incluye lote FEFO, diasAlVencimiento y stockDisponibleVenta por producto.
   */
  async catalogoFarmacia(params: {
    empresaId: number;
    sedeId: number;
    page?: number;
    limit?: number;
    search?: string;
    categoriaId?: number;
    usuarioId?: number;
  }) {
    const { empresaId, sedeId, categoriaId } = params;
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const skip = (page - 1) * limit;
    const searchTerm = params.search?.trim();

    const where: any = {
      empresaId,
      estado: EstadoType.ACTIVO,
      ...(categoriaId ? { categoriaId: Number(categoriaId) } : {}),
      stocks: {
        some: {
          sedeId,
          visibleEnSede: true,
          vendibleEnSede: true,
        },
      },
    };

    // Búsqueda flexible por palabras (misma lógica que `listar`).
    const searchAnd = this.busquedaPorPalabras(searchTerm);
    if (searchAnd) where.AND = searchAnd;

    const [productosRaw, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limit,
        orderBy: { descripcion: 'asc' },
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          imagenUrl: true,
          precioUnitario: true,
          moneda: true,
          igvPorcentaje: true,
          tipoAfectacionIGV: true,
          unidadMedidaId: true,
          refrigerado: true,
          requiereReceta: true,
          controlado: true,
          categoriaId: true,
          // Fraccionamiento
          factorConversion: true,
          unidadCompra: true,
          unidadVenta: true,
          stock: true,
          porcentajeVenta: true,
          porcentajeProvision: true,
          codigoBarras: true,
          atributosTecnicos: true,
          unidadMedida: { select: { codigo: true } },
          stocks: {
            where: { sedeId },
            select: {
              stock: true,
              visibleEnSede: true,
              vendibleEnSede: true,
              precioUnitarioOverride: true,
              precioOfertaOverride: true,
            },
          },
          lotes: {
            where: {
              activo: true,
              stockActual: { gt: 0 },
              fechaVencimiento: { gt: new Date() },
            },
            select: {
              id: true,
              lote: true,
              fechaVencimiento: true,
              stockActual: true,
              costoUnitario: true,
            },
            orderBy: { fechaVencimiento: 'asc' }, // FEFO — primer elemento es el más próximo a vencer
          },
        },
      }),
      this.prisma.producto.count({ where }),
    ]);

    // Reservas activas para calcular stockDisponibleVenta
    const productoIds = productosRaw.map((p) => p.id);
    const reservasAgrupadas =
      productoIds.length > 0
        ? await this.prisma.reserva.groupBy({
            by: ['productoId'],
            where: {
              empresaId,
              sedeId,
              productoId: { in: productoIds },
              estado: {
                in: [EstadoReserva.PENDIENTE, EstadoReserva.CONFIRMADA],
              },
            },
            _sum: { cantidad: true },
          })
        : [];
    const reservadoPorProducto = new Map<number, number>(
      reservasAgrupadas.map((r) => [r.productoId, r._sum.cantidad ?? 0]),
    );

    // Lista de precio que aplica al usuario/sede en el catálogo de farmacia
    // (siempre contexto de venta).
    const itemsLista = await this.cargarItemsListaPrecio(
      empresaId,
      params.usuarioId,
      sedeId,
    );

    const hoy = new Date();

    // Lotes VENCIDOS con stock: se excluyen de la venta (p.lotes ya los filtra),
    // pero los detectamos aparte para (1) dar un mensaje correcto en el POS y
    // (2) NO caer al stock plano en productos que sí gestionan lotes.
    const lotesVencidosAgrupados =
      productoIds.length > 0
        ? await this.prisma.productoLote.groupBy({
            by: ['productoId'],
            where: {
              productoId: { in: productoIds },
              activo: true,
              stockActual: { gt: 0 },
              fechaVencimiento: { lte: hoy },
            },
            _sum: { stockActual: true },
          })
        : [];
    const stockVencidoPorProducto = new Map<number, number>(
      lotesVencidosAgrupados.map((l) => [
        l.productoId,
        Number(l._sum.stockActual ?? 0),
      ]),
    );

    const productos = productosRaw.map((p) => {
      const loteFefo = p.lotes[0] ?? null; // primer lote FEFO (más próximo a vencer)
      const stockTotalLotes = p.lotes.reduce(
        (sum, l) => sum + Number(l.stockActual ?? 0),
        0,
      );
      const stockVencido = stockVencidoPorProducto.get(p.id) ?? 0;
      const tieneLotesVencidos = stockVencido > 0;
      // Un producto "gestiona lotes" si tiene lotes vigentes o vencidos. En ese
      // caso el stock vendible es SOLO el de lotes vigentes (puede ser 0). Solo
      // cae al stock plano cuando el producto nunca tuvo lotes.
      const esLoteGestionado = stockTotalLotes > 0 || tieneLotesVencidos;
      // Lotes no tienen sedeId, así que su suma global no debe sobreescribir el stock real de la sede.
      // Ya que en catalogoFarmacia siempre se filtra por sede, usamos estrictamente ProductoStock.
      const stockBase = num(p.stocks[0]?.stock);
      const stockSede = p.stocks[0] as any | undefined;
      const { precioUnitario } = this.resolverPrecioConLista(
        itemsLista,
        p.id,
        '',
        true,
        stockSede?.precioUnitarioOverride,
        stockSede?.precioOfertaOverride,
        Number(p.precioUnitario),
        null,
      );
      const reservado = reservadoPorProducto.get(p.id) ?? 0;
      const cupoProvision = Math.floor(
        (stockBase * (p.porcentajeProvision ?? 0)) / 100,
      );
      const cupoVenta = Math.max(0, stockBase - cupoProvision);
      const stockDisponibleVenta = Math.max(
        0,
        Math.min(stockBase - reservado, cupoVenta),
      );

      let diasAlVencimiento: number | null = null;
      if (loteFefo?.fechaVencimiento) {
        diasAlVencimiento = Math.floor(
          (new Date(loteFefo.fechaVencimiento).getTime() - hoy.getTime()) /
            (1000 * 60 * 60 * 24),
        );
      }

      return {
        id: p.id,
        codigo: p.codigo,
        descripcion: p.descripcion,
        imagenUrl: p.imagenUrl,
        precioUnitario,
        igvPorcentaje: Number(p.igvPorcentaje),
        tipoAfectacionIGV: p.tipoAfectacionIGV,
        unidadCodigo: (p as any).unidadMedida?.codigo ?? '',
        refrigerado: p.refrigerado,
        requiereReceta: p.requiereReceta,
        controlado: p.controlado,
        categoriaId: p.categoriaId,
        // Fraccionamiento
        factorConversion: Number(p.factorConversion ?? 1),
        unidadCompra: (p as any).unidadCompra ?? null,
        unidadVenta: (p as any).unidadVenta ?? null,
        stock: stockDisponibleVenta,
        stockDisponibleVenta,
        stockReservado: reservado,
        tieneLotesVencidos,
        stockVencido,
        loteFefoCostoUnitario: loteFefo?.costoUnitario
          ? Number(loteFefo.costoUnitario)
          : null,
        lotesDisponibles: p.lotes.map((l) => ({
          loteId: l.id,
          loteNumero: l.lote,
          stockActual: l.stockActual,
          costoUnitario: l.costoUnitario ? Number(l.costoUnitario) : null,
          fechaVencimiento: l.fechaVencimiento,
        })),
        loteFefo: loteFefo
          ? {
              loteId: loteFefo.id,
              loteNumero: loteFefo.lote,
              fechaVencimiento: loteFefo.fechaVencimiento,
              stockActual: loteFefo.stockActual,
              costoUnitario: loteFefo.costoUnitario
                ? Number(loteFefo.costoUnitario)
                : null,
              stockDisponibleVenta,
              diasAlVencimiento,
            }
          : null,
      };
    });

    return { productos, total, page, limit };
  }

  async obtenerPorId(id: number, empresaId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId },
      include: {
        unidadMedida: true,
        categoria: true,
        marca: true,
        variantes: {
          select: {
            id: true,
            codigo: true,
            descripcion: true,
            precioUnitario: true,
            moneda: true,
            precioOferta: true,
            stock: true,
            estado: true,
            valoresAtributos: true,
            imagenUrl: true,
            codigoBarras: true,
          },
        },
        codigosBarras: {
          select: {
            codigo: true,
            unidadesPorPaquete: true,
            precioPaquete: true,
            alias: true,
            codigoInterno: true,
            imagenUrl: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const normalizePersistentImageUrl = (url?: string | null) => {
      if (!url) return url as any;
      return url.includes('amazonaws.com/') ? url.split('?')[0] : url;
    };

    const signIfS3 = async (url?: string | null) => {
      const persistentUrl = normalizePersistentImageUrl(url);
      if (!persistentUrl) return persistentUrl;
      try {
        const idx = persistentUrl.indexOf('amazonaws.com/');
        if (idx === -1) return persistentUrl;
        const key = persistentUrl.substring(idx + 'amazonaws.com/'.length);
        if (!key) return persistentUrl;
        const signed = await this.s3.getSignedGetUrl(key, 600);
        return signed || persistentUrl;
      } catch {
        return url as any;
      }
    };

    const imagenUrl = normalizePersistentImageUrl(
      (producto as any).imagenUrl as string | null,
    );
    const variantes = await Promise.all(
      (((producto as any).variantes as any[]) || []).map(
        async (variante: any) => {
          const varianteImagenUrl = normalizePersistentImageUrl(
            variante.imagenUrl as string | null,
          );
          return {
            ...variante,
            imagenUrl: varianteImagenUrl,
            imagenUrlDisplay: await signIfS3(varianteImagenUrl),
          };
        },
      ),
    );

    const imagenesExtra = this.parseImagenesExtra(
      (producto as any).imagenesExtra,
    ).map((u) => normalizePersistentImageUrl(u) as string);
    const imagenesExtraDisplay = await Promise.all(
      imagenesExtra.map((u) => signIfS3(u)),
    );

    return {
      ...producto,
      variantes,
      imagenUrl,
      imagenUrlDisplay: await signIfS3(imagenUrl),
      imagenesExtra,
      imagenesExtraDisplay,
      costoUnitario: Number((producto as any).costoPromedio) || 0,
      codigosBarrasExtra: await Promise.all(
        (((producto as any).codigosBarras as any[]) || []).map(async (c) => ({
          codigo: c.codigo,
          unidadesPorPaquete: c.unidadesPorPaquete ?? 1,
          precioPaquete:
            c.precioPaquete != null ? Number(c.precioPaquete) : null,
          alias: c.alias ?? null,
          codigoInterno: c.codigoInterno ?? null,
          imagenUrl: c.imagenUrl ?? null,
          imagenUrlDisplay: await signIfS3(c.imagenUrl),
        })),
      ),
    };
  }

  /**
   * Reemplaza el conjunto completo de códigos de barra ADICIONALES de un producto.
   * Pensado para el caso "mismo producto, distinto EAN por lote/importación": todos
   * los códigos apuntan al MISMO producto (mismo precio y stock). Si `codigos` es
   * `undefined` no se toca nada (el cliente no envió el campo). Normaliza, deduplica,
   * ignora el código principal y valida colisiones contra otros productos.
   */
  /**
   * Normaliza (trim + uppercase), quita vacíos/duplicados y descarta el código
   * principal. Acepta tanto strings sueltos (compat con clientes viejos/sync
   * offline) como objetos `{codigo, unidadesPorPaquete}` — un código con
   * `unidadesPorPaquete > 1` representa un PAQUETE (ej. six-pack) del mismo
   * producto: comparte el mismo stock, pero escanearlo vende/descuenta N
   * unidades en vez de 1.
   */
  private normalizarCodigosExtra(
    codigos: Array<
      | string
      | {
          codigo: string;
          unidadesPorPaquete?: number;
          precioPaquete?: number;
          alias?: string;
          codigoInterno?: string;
          imagenUrl?: string;
        }
    >,
    codigoBarrasPrincipal?: string | null,
  ): Array<{
    codigo: string;
    unidadesPorPaquete: number;
    precioPaquete: number | null;
    alias: string | null;
    codigoInterno: string | null;
    imagenUrl: string | null;
  }> {
    const principal = (codigoBarrasPrincipal || '').trim().toUpperCase();
    const vistos = new Map<
      string,
      {
        unidadesPorPaquete: number;
        precioPaquete: number | null;
        alias: string | null;
        codigoInterno: string | null;
        imagenUrl: string | null;
      }
    >();
    for (const raw of codigos || []) {
      const esObjeto = typeof raw === 'object' && raw !== null;
      const codigo = ((esObjeto ? raw.codigo : raw) || '').trim().toUpperCase();
      if (!codigo || codigo === principal) continue;
      const unidades = Math.max(
        1,
        Math.trunc(Number(esObjeto ? raw.unidadesPorPaquete : 1) || 1),
      );
      // Precio TOTAL del paquete (opcional; solo válido si es > 0).
      const precioRaw = esObjeto ? Number(raw.precioPaquete) : NaN;
      const precioPaquete =
        Number.isFinite(precioRaw) && precioRaw > 0 ? precioRaw : null;
      const alias = (esObjeto ? String(raw.alias || '').trim() : '') || null;
      const codigoInterno =
        (esObjeto
          ? String(raw.codigoInterno || '')
              .trim()
              .toUpperCase()
          : '') || null;
      const imagenUrl =
        (esObjeto ? String(raw.imagenUrl || '').trim() : '') || null;
      vistos.set(codigo, {
        unidadesPorPaquete: unidades,
        precioPaquete,
        alias,
        codigoInterno,
        imagenUrl,
      });
    }
    return Array.from(vistos, ([codigo, extra]) => ({ codigo, ...extra }));
  }

  /**
   * Valida que ningún código choque con el código (principal o alterno) de OTRO
   * producto. Se llama ANTES de crear/mutar el producto para no dejar huérfanos.
   */
  private async validarColisionCodigosExtra(
    empresaId: number,
    codigos: Array<{ codigo: string; codigoInterno?: string | null }>,
    excludeProductoId?: number,
  ) {
    // El código interno de una presentación no puede repetir el SKU, el código
    // de barras ni el código interno de OTRO producto (se busca/escanea igual).
    for (const { codigoInterno } of codigos) {
      if (!codigoInterno) continue;
      const chocaSku = await this.prisma.producto.findFirst({
        where: {
          empresaId,
          estado: { not: 'PLACEHOLDER' as any },
          ...(excludeProductoId ? { id: { not: excludeProductoId } } : {}),
          OR: [
            { codigo: { equals: codigoInterno, mode: 'insensitive' } },
            { codigoBarras: { equals: codigoInterno, mode: 'insensitive' } },
          ],
        },
        select: { descripcion: true },
      });
      if (chocaSku) {
        throw new ForbiddenException(
          `El código interno "${codigoInterno}" ya es el código de otro producto: ${chocaSku.descripcion}`,
        );
      }
      const chocaInterno = await this.prisma.productoCodigoBarras.findFirst({
        where: {
          empresaId,
          ...(excludeProductoId
            ? { productoId: { not: excludeProductoId } }
            : {}),
          OR: [
            { codigoInterno: { equals: codigoInterno, mode: 'insensitive' } },
            { codigo: { equals: codigoInterno, mode: 'insensitive' } },
          ],
        },
        select: { producto: { select: { descripcion: true } } },
      });
      if (chocaInterno) {
        throw new ForbiddenException(
          `El código interno "${codigoInterno}" ya está asignado a otro producto: ${chocaInterno.producto?.descripcion}`,
        );
      }
    }
    for (const { codigo } of codigos) {
      const chocaPrincipal = await this.prisma.producto.findFirst({
        where: {
          empresaId,
          codigoBarras: codigo,
          estado: { not: 'PLACEHOLDER' as any },
          ...(excludeProductoId ? { id: { not: excludeProductoId } } : {}),
        },
        select: { descripcion: true },
      });
      if (chocaPrincipal) {
        throw new ForbiddenException(
          `El código de barras "${codigo}" ya está asignado a otro producto: ${chocaPrincipal.descripcion}`,
        );
      }
      const chocaAlterno = await this.prisma.productoCodigoBarras.findFirst({
        where: {
          empresaId,
          codigo,
          ...(excludeProductoId
            ? { productoId: { not: excludeProductoId } }
            : {}),
        },
        select: { producto: { select: { descripcion: true } } },
      });
      if (chocaAlterno) {
        throw new ForbiddenException(
          `El código de barras "${codigo}" ya está asignado a otro producto: ${chocaAlterno.producto?.descripcion}`,
        );
      }
    }
  }

  private async sincronizarCodigosBarrasExtra(
    productoId: number,
    empresaId: number,
    codigos:
      | Array<
          | string
          | {
              codigo: string;
              unidadesPorPaquete?: number;
              precioPaquete?: number;
              alias?: string;
              imagenUrl?: string;
            }
        >
      | undefined,
    codigoBarrasPrincipal?: string | null,
  ) {
    if (codigos === undefined) return;

    const limpios = this.normalizarCodigosExtra(codigos, codigoBarrasPrincipal);

    await this.validarColisionCodigosExtra(empresaId, limpios, productoId);

    // Imagen del paquete: si el frontend mandó un data-URI base64, subir a S3
    // y guardar la URL. Best-effort: si falla la subida, el código se guarda
    // igual sin imagen (es solo presentación).
    for (const item of limpios) {
      if (item.imagenUrl?.startsWith('data:image')) {
        try {
          const match = item.imagenUrl.match(
            /^data:(image\/[\w.+-]+);base64,(.+)$/,
          );
          if (!match) {
            item.imagenUrl = null;
            continue;
          }
          const buffer = Buffer.from(match[2], 'base64');
          const key = this.s3.generateProductoImageKey(
            empresaId,
            productoId,
            match[1],
            true,
          );
          item.imagenUrl = await this.s3.uploadImage(buffer, key, match[1]);
        } catch (error) {
          console.error('No se pudo subir la imagen del paquete:', error);
          item.imagenUrl = null;
        }
      }
    }

    // Reemplazar el set completo de alternos del producto de forma atómica.
    await this.prisma.$transaction([
      this.prisma.productoCodigoBarras.deleteMany({ where: { productoId } }),
      ...(limpios.length
        ? [
            this.prisma.productoCodigoBarras.createMany({
              data: limpios.map(
                ({
                  codigo,
                  unidadesPorPaquete,
                  precioPaquete,
                  alias,
                  codigoInterno,
                  imagenUrl,
                }) => ({
                  productoId,
                  empresaId,
                  codigo,
                  unidadesPorPaquete,
                  precioPaquete,
                  alias,
                  codigoInterno,
                  imagenUrl,
                }),
              ),
            }),
          ]
        : []),
    ]);
  }

  /**
   * Busca en el catálogo local de la empresa un producto cuyo código de barras
   * coincida EXACTAMENTE, y lo devuelve con la forma que espera el POS/escáner
   * (stock resuelto por sede/lotes, variantes, etc.). Devuelve null si no existe.
   */
  private async buscarProductoLocalPorBarcodeExacto(
    empresaId: number,
    codigoBarras: string,
    sedeId?: number,
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: {
        empresaId,
        estado: { not: 'PLACEHOLDER' as any },
        // Coincide por el código principal O por cualquier código alterno del
        // producto (mismo perfume con distinto EAN según lote/importación).
        OR: [
          { codigoBarras },
          { codigosBarras: { some: { codigo: codigoBarras } } },
          // Código interno del negocio para una presentación (ej. "22005-CJ").
          {
            codigosBarras: {
              some: {
                codigoInterno: { equals: codigoBarras, mode: 'insensitive' },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        costoPromedio: true,
        precioUnitario: true,
        stock: true,
        stocks: {
          where: sedeId ? { sedeId } : undefined,
          select: {
            stock: true,
            sedeId: true,
            visibleEnSede: true,
          },
        },
        lotes: {
          where: {
            activo: true,
            stockActual: { gt: 0 },
          },
          select: {
            lote: true,
            fechaVencimiento: true,
            stockActual: true,
            costoUnitario: true,
          },
          orderBy: {
            fechaVencimiento: 'asc',
          },
        },
        codigoBarras: true,
        codigosBarras: {
          select: {
            codigo: true,
            unidadesPorPaquete: true,
            precioPaquete: true,
            alias: true,
            codigoInterno: true,
            imagenUrl: true,
          },
        },
        imagenUrl: true,
        tipoAfectacionIGV: true,
        unidadMedida: true,
        categoria: true,
        marca: true,
        // Variantes: si se escanea un producto padre, el POS abre el selector de talla/color
        variantes: {
          where: { estado: { in: [EstadoType.ACTIVO, EstadoType.INACTIVO] } },
          select: {
            id: true,
            codigo: true,
            descripcion: true,
            precioUnitario: true,
            moneda: true,
            precioOferta: true,
            stock: true,
            valoresAtributos: true,
            imagenUrl: true,
            codigoBarras: true,
            estado: true,
          },
        },
      },
    });

    if (!producto) return null;

    // El código escaneado puede ser el principal (siempre 1 unidad) o un
    // código alterno registrado con `unidadesPorPaquete` (ej. el six-pack).
    const buscado = String(codigoBarras).trim().toUpperCase();
    const codigoAlternoMatch = ((producto.codigosBarras as any[]) || []).find(
      (c) =>
        c.codigo === codigoBarras ||
        String(c.codigoInterno || '').toUpperCase() === buscado,
    );
    const unidadesPorPaquete = codigoAlternoMatch
      ? Number(codigoAlternoMatch.unidadesPorPaquete) || 1
      : 1;
    // Precio TOTAL del paquete (si el código escaneado lo definió): el POS lo
    // usa en vez de precioUnitario × unidades (los packs suelen ser más baratos).
    const precioPaquete =
      codigoAlternoMatch?.precioPaquete != null
        ? Number(codigoAlternoMatch.precioPaquete) || null
        : null;
    // Nombre e imagen propios del paquete: el POS los usa como descripción e
    // imagen de la línea cuando se escanea este código.
    const aliasPaquete = codigoAlternoMatch?.alias || null;
    const imagenPaquete = codigoAlternoMatch?.imagenUrl || null;

    const stockDesdeLotes = (producto.lotes || []).reduce(
      (acc, lote) => acc + Number(lote.stockActual || 0),
      0,
    );
    const usaStockLotes = stockDesdeLotes > 0;
    const loteFefoActual = usaStockLotes ? producto.lotes[0] : null;
    const stockBase = sedeId
      ? (producto.stocks[0]?.stock ?? 0)
      : producto.stocks?.length
        ? producto.stocks.reduce((sum, s) => sum + Number(s.stock || 0), 0)
        : Number((producto as any).stock || 0);
    const stockTotal = usaStockLotes && !sedeId ? stockDesdeLotes : stockBase;

    return {
      ...producto,
      stock: stockTotal,
      stockBase: stockTotal,
      // false = el producto existe pero NO está asignado a la sede consultada;
      // el POS lo avisa en vez de venderlo.
      disponibleEnSede: sedeId
        ? producto.stocks[0]?.visibleEnSede !== false
        : true,
      loteFefoCodigo: loteFefoActual?.lote || null,
      loteFefoVencimiento: loteFefoActual?.fechaVencimiento || null,
      loteFefoCostoUnitario: loteFefoActual?.costoUnitario
        ? Number(loteFefoActual.costoUnitario)
        : null,
      isGlobal: false,
      costoUnitario: Number((producto as any).costoPromedio) || 0,
      // Cuántas unidades del stock representa el código que se acaba de escanear.
      unidadesPorPaquete,
      precioPaquete,
      aliasPaquete,
      imagenPaquete,
      codigoEscaneado: codigoBarras,
    };
  }

  // ─── Códigos de barra internos (EAN-13 prefijo 2) ──────────────────────────

  /**
   * Códigos ya ocupados en la empresa, para no pisar uno existente. Mira tanto
   * el código principal del producto como los alternos de ProductoCodigoBarras.
   */
  private async codigosBarrasOcupados(
    empresaId: number,
    excluirProductoIds: number[] = [],
  ): Promise<Set<string>> {
    const [principales, alternos] = await Promise.all([
      this.prisma.producto.findMany({
        where: {
          empresaId,
          codigoBarras: { not: null },
          ...(excluirProductoIds.length
            ? { id: { notIn: excluirProductoIds } }
            : {}),
        },
        select: { codigoBarras: true },
      }),
      this.prisma.productoCodigoBarras.findMany({
        where: { empresaId },
        select: { codigo: true },
      }),
    ]);
    const set = new Set<string>();
    for (const p of principales) if (p.codigoBarras) set.add(p.codigoBarras);
    for (const a of alternos) set.add(a.codigo);
    return set;
  }

  /**
   * Asigna códigos EAN-13 internos a los productos indicados.
   *
   * - `forzar` en false (default) respeta el código que el producto ya tenga:
   *   nunca se pisa un EAN de fábrica escaneado por el usuario.
   * - `incluirVariantes` alcanza a los Producto hijos, que es lo que se etiqueta
   *   en ropa (cada talla×color lleva su propia etiqueta).
   */
  async generarCodigosBarras(
    empresaId: number,
    productoIds: number[],
    opts: { forzar?: boolean; incluirVariantes?: boolean } = {},
  ): Promise<{
    generados: { id: number; codigoBarras: string }[];
    omitidos: { id: number; motivo: string }[];
  }> {
    const ids = [...new Set(productoIds.map(Number).filter(Number.isInteger))];
    if (!ids.length) {
      throw new BadRequestException('Indica al menos un producto.');
    }

    // Padres pedidos + (opcional) sus variantes, siempre acotado a la empresa.
    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        estado: { not: 'ELIMINADO' as any },
        OR: [
          { id: { in: ids } },
          ...(opts.incluirVariantes ? [{ productoPadreId: { in: ids } }] : []),
        ],
      },
      select: { id: true, codigoBarras: true, descripcion: true },
      orderBy: { id: 'asc' },
    });
    if (!productos.length) {
      throw new NotFoundException('No se encontraron productos para generar.');
    }

    const ocupados = await this.codigosBarrasOcupados(
      empresaId,
      productos.map((p) => p.id),
    );
    const generados: { id: number; codigoBarras: string }[] = [];
    const omitidos: { id: number; motivo: string }[] = [];

    for (const producto of productos) {
      const actual = String(producto.codigoBarras ?? '').trim();
      if (actual && !opts.forzar) {
        omitidos.push({ id: producto.id, motivo: 'ya tiene código' });
        continue;
      }

      // El código es determinista por id; si estuviera ocupado por otro producto
      // (p. ej. alguien lo tecleó a mano) se desplaza dentro del espacio interno.
      let codigo = generarEan13DesdeProductoId(producto.id);
      let intento = 0;
      while (ocupados.has(codigo) && intento < 20) {
        intento++;
        codigo = generarEan13Alternativo(producto.id, intento);
      }
      if (ocupados.has(codigo)) {
        omitidos.push({
          id: producto.id,
          motivo: 'no se encontró un código libre',
        });
        continue;
      }

      ocupados.add(codigo);
      generados.push({ id: producto.id, codigoBarras: codigo });
    }

    if (generados.length) {
      await this.prisma.$transaction(
        generados.map((g) =>
          this.prisma.producto.update({
            where: { id: g.id },
            data: { codigoBarras: g.codigoBarras },
          }),
        ),
      );
    }

    return { generados, omitidos };
  }

  /**
   * Datos mínimos para imprimir etiquetas: el código de barras más lo que el
   * usuario puede decidir mostrar (nombre, variante, precio).
   */
  async datosEtiquetas(empresaId: number, productoIds: number[]) {
    const ids = [...new Set(productoIds.map(Number).filter(Number.isInteger))];
    if (!ids.length)
      throw new BadRequestException('Indica al menos un producto.');

    // Se etiqueta lo que existe físicamente: si un producto tiene variantes, la
    // etiqueta va en cada talla×color, no en el padre (que es solo el agrupador).
    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId,
        estado: { not: 'ELIMINADO' as any },
        OR: [{ id: { in: ids } }, { productoPadreId: { in: ids } }],
      },
      select: {
        id: true,
        codigo: true,
        descripcion: true,
        codigoBarras: true,
        precioUnitario: true,
        precioOferta: true,
        valoresAtributos: true,
        productoPadreId: true,
        productoPadre: { select: { descripcion: true } },
        _count: { select: { variantes: true } },
      },
      orderBy: { id: 'asc' },
    });

    return productos
      .filter((p) => p._count.variantes === 0)
      .map((p) => ({
        id: p.id,
        codigo: p.codigo,
        // En una variante, `descripcion` ya viene compuesta; el padre sirve de
        // respaldo cuando la variante no trae nombre propio.
        nombre: p.productoPadre?.descripcion ?? p.descripcion,
        descripcion: p.descripcion,
        codigoBarras: p.codigoBarras,
        valido: esEan13Valido(String(p.codigoBarras ?? '')),
        // El precio de la etiqueta es el que paga el cliente: la oferta manda.
        precio: Number(p.precioOferta ?? p.precioUnitario ?? 0),
        variante: this.etiquetaVariante(p.valoresAtributos),
        esVariante: p.productoPadreId != null,
      }));
  }

  /** "Azul Persa · M" a partir de `valoresAtributos` ({ Color: 'Azul Persa' }). */
  private etiquetaVariante(valores: any): string | null {
    if (!valores || typeof valores !== 'object' || Array.isArray(valores)) {
      return null;
    }
    const partes = Object.values(valores)
      .map((v) => String(v ?? '').trim())
      .filter(Boolean);
    return partes.length ? partes.join(' · ') : null;
  }

  async getByBarcode(empresaId: number, codigoBarras: string, sedeId?: number) {
    // Determinar rubro para priorizar la fuente de búsqueda global correcta
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId },
      select: { rubro: { select: { nombre: true } } },
    });
    const rubroNombre = (empresa?.rubro?.nombre ?? '').toLowerCase();
    const esFarmaceutico =
      rubroNombre.includes('farmacia') ||
      rubroNombre.includes('botica') ||
      rubroNombre.includes('medicament') ||
      rubroNombre.includes('drogueria') ||
      rubroNombre.includes('droguería');

    // 1. Catálogo local — coincidencia EXACTA por código de barras.
    const exacto = await this.buscarProductoLocalPorBarcodeExacto(
      empresaId,
      codigoBarras,
      sedeId,
    );
    if (exacto) return exacto;

    // 1b. Coincidencia por PREFIJO (al menos las primeras 4 letras/números).
    //     Solo si no hubo match exacto. Si hay varias, se avisa al frontend
    //     con `multipleMatches` y no se agrega nada (evita facturar el equivocado).
    if (codigoBarras.length >= 4) {
      const coincidencias = await this.prisma.producto.findMany({
        where: {
          empresaId,
          codigoBarras: { startsWith: codigoBarras, mode: 'insensitive' },
          estado: { not: 'PLACEHOLDER' as any },
        },
        select: { id: true, descripcion: true, codigoBarras: true },
        orderBy: { codigoBarras: 'asc' },
        take: 6,
      });
      if (coincidencias.length === 1 && coincidencias[0].codigoBarras) {
        const unico = await this.buscarProductoLocalPorBarcodeExacto(
          empresaId,
          coincidencias[0].codigoBarras,
          sedeId,
        );
        if (unico) return unico;
      }
      if (coincidencias.length > 1) {
        return {
          multipleMatches: true,
          count: coincidencias.length,
          coincidencias,
        };
      }
    }

    // 2+3+4. Búsqueda en catálogos globales — orden según rubro
    if (esFarmaceutico) {
      // Farmacias/boticas/droguerías:
      // 2. DIGEMID local (registro sanitario peruano — más confiable para Perú)
      const digemidProduct =
        await this.digemidService.buscarPorBarcode(codigoBarras);
      if (digemidProduct) {
        return {
          id: 0,
          codigo: `DIGEMID-${codigoBarras}`,
          descripcion: digemidProduct.nombreComercial,
          codigoBarras,
          imagenUrl: null,
          precioUnitario: 0,
          costoUnitario: 0,
          stock: 0,
          tipoAfectacionIGV: '20', // Exonerado de IGV
          principioActivo: digemidProduct.principioActivo,
          laboratorio: digemidProduct.laboratorio,
          presentacion: digemidProduct.presentacion,
          concentracion: digemidProduct.concentracion,
          formaFarmaceutica: digemidProduct.formaFarmaceutica,
          registroSanitario: digemidProduct.registroSanitario,
          condicionVenta: digemidProduct.condicionVenta,
          categoriaStr: 'Medicamentos',
          fuenteGlobal: 'DIGEMID',
          isGlobal: true,
        };
      }

      // 3. OpenFDA (medicamentos con NDC code — principalmente importados de USA)
      const fdaProduct = await this.buscarEnOpenFDA(codigoBarras);
      if (fdaProduct) return { ...fdaProduct, isGlobal: true };
    } else {
      // Resto de rubros: Open Food Facts primero, FDA como fallback
      const offProduct = await this.buscarEnOpenFoodFacts(codigoBarras);
      if (offProduct) return { ...offProduct, isGlobal: true };

      const fdaProduct = await this.buscarEnOpenFDA(codigoBarras);
      if (fdaProduct) return { ...fdaProduct, isGlobal: true };
    }

    return null;
  }

  private async buscarEnOpenFoodFacts(barcode: string) {
    try {
      const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
      const { data } = await axios.get(url, { timeout: 5000 });

      if (data?.status === 1 && data.product) {
        const p = data.product;
        return {
          id: 0,
          codigo: `OFF-${barcode}`,
          descripcion:
            p.product_name || p.generic_name || 'Producto Desconocido',
          codigoBarras: barcode,
          imagenUrl: p.image_url || p.image_front_url || null,
          precioUnitario: 0,
          costoUnitario: 0,
          stock: 0,
          tipoAfectacionIGV: '10',
          marcaStr: p.brands || null,
          categoriaStr: p.categories_tags?.[0]?.replace('en:', '') || null,
        };
      }
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        console.error(
          `[OpenFoodFacts] Error buscando barcode ${barcode}:`,
          error.message,
        );
      }
    }
    return null;
  }

  private async buscarEnOpenFDA(barcode: string) {
    try {
      // NDC (National Drug Code) — formato estándar en etiquetas de medicamentos
      // Intentar con el barcode tal cual y también sin el primer dígito (check digit)
      const queries = [
        barcode,
        barcode.length === 12 ? barcode.slice(1) : null,
      ].filter(Boolean);

      for (const query of queries) {
        const url = `https://api.fda.gov/drug/ndc.json?search=product_ndc:"${query}"&limit=1`;
        const { data } = await axios.get(url, { timeout: 6000 });

        if (data?.results?.length > 0) {
          const drug = data.results[0];
          const activeIngredient = Array.isArray(drug.active_ingredients)
            ? drug.active_ingredients[0]
            : null;

          return {
            id: 0,
            codigo: `FDA-${barcode}`,
            descripcion: drug.brand_name || drug.generic_name || 'Medicamento',
            codigoBarras: barcode,
            imagenUrl: null,
            precioUnitario: 0,
            costoUnitario: 0,
            stock: 0,
            // Medicamentos en Perú: exonerados de IGV (Catálogo 07 SUNAT código 20)
            tipoAfectacionIGV: '20',
            // Campos farmacéuticos
            principioActivo: drug.generic_name || null,
            laboratorio: drug.labeler_name || null,
            presentacion: drug.dosage_form || null,
            concentracion: activeIngredient?.strength || null,
            unidadVenta:
              drug.packaging?.[0]?.description?.split(' ')[0] || null,
            marcaStr: drug.brand_name || drug.labeler_name || null,
            categoriaStr: 'Medicamentos',
            // Fuente para mostrar badge en UI
            fuenteGlobal: 'FDA',
          };
        }
      }
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        console.error(
          `[OpenFDA] Error buscando barcode ${barcode}:`,
          error.message,
        );
      }
    }
    return null;
  }

  async actualizar(
    data: {
      id: number;
      empresaId: number;
      codigo?: string;
      descripcion?: string;
      categoriaId?: number | null;
      marcaId?: number | null;
      unidadMedidaId?: number;
      tipoAfectacionIGV?: string;
      moneda?: string;
      valorUnitario?: number;
      igvPorcentaje?: number;
      precioUnitario?: number;
      stock?: number;
      costoUnitario?: number;
      costoFijo?: number;
      comisionPorVenta?: number;
      comisionPorcentaje?: number;
      imagenUrl?: string | null;
      removerImagen?: boolean;
      localizacion?: string;
      porcentajeVenta?: number;
      porcentajeProvision?: number;
      stockMinimo?: number;
      stockMaximo?: number;
      // Campos Farmacia
      principioActivo?: string;
      concentracion?: string;
      presentacion?: string;
      laboratorio?: string;
      unidadCompra?: string;
      unidadVenta?: string;
      factorConversion?: number | string;
      codigoBarras?: string;
      codigosBarrasExtra?: Array<
        | string
        | {
            codigo: string;
            unidadesPorPaquete?: number;
            precioPaquete?: number;
            alias?: string;
            codigoInterno?: string;
            imagenUrl?: string;
          }
      >;
      codigoDigemid?: string;
      codProdSunat?: string;
      // Campos Ofertas
      precioOferta?: number;
      fechaInicioOferta?: string | Date;
      fechaFinOferta?: string | Date;
      preciosMayorista?: { cantidadMinima: number; precio: number }[];
      atributosTecnicos?: Record<string, any> | null;
      opcionesAtributos?: any;
      valoresAtributos?: any;
      productoPadreId?: number | null;
      variantesConfig?: VarianteConfig[];
      descripcionLarga?: string | null;
      publicarEnTienda?: boolean;
      visibleEnSede?: boolean;
      vendibleEnSede?: boolean;
      precioUnitarioSede?: number | null;
      precioOfertaSede?: number | null;
      ubicacionSede?: string | null;
      /** Sedes donde queda disponible (ids). Reemplaza la disponibilidad actual. */
      sedesDisponibles?: number[] | null;

      sedeId?: number; // Nueva propiedad opcional para identificar dónde se ajusta el stock
    },
    usuarioId?: number,
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: data.id, empresaId: data.empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    const esServicio = this.esProductoServicio(
      data.atributosTecnicos ?? (producto.atributosTecnicos as any),
    );
    if (esServicio) {
      data.stock = 0;
      data.stockMinimo = 0;
      data.stockMaximo = 0;
      data.porcentajeVenta = 100;
      data.porcentajeProvision = 0;
    }

    // Validar unicidad del Código de producto (SKU) si cambió: no puede repetirse
    // dentro de la empresa. Normaliza vacío → conserva el actual (no lo borra).
    if (data.codigo !== undefined) {
      const nuevoCodigo = String(data.codigo).trim();
      if (!nuevoCodigo) {
        // No permitir dejar el código vacío: se mantiene el existente.
        delete data.codigo;
      } else if (nuevoCodigo !== producto.codigo) {
        const existeCodigo = await this.prisma.producto.findFirst({
          where: {
            empresaId: data.empresaId,
            codigo: nuevoCodigo,
            id: { not: data.id },
            estado: { not: 'PLACEHOLDER' as any },
          },
          select: { descripcion: true },
        });
        if (existeCodigo) {
          throw new ForbiddenException(
            `El código "${nuevoCodigo}" ya está asignado a otro producto: ${existeCodigo.descripcion}`,
          );
        }
        data.codigo = nuevoCodigo;
      } else {
        // Igual al actual: nada que cambiar.
        delete data.codigo;
      }
    }

    // Validar unicidad de Código de Barras (si cambió) — contra el código PRINCIPAL
    // de otros productos y contra sus códigos ALTERNOS/de paquete.
    if (data.codigoBarras && data.codigoBarras !== producto.codigoBarras) {
      const existeBarras = await this.prisma.producto.findFirst({
        where: {
          empresaId: data.empresaId,
          codigoBarras: data.codigoBarras,
          id: { not: data.id },
          estado: { not: 'PLACEHOLDER' as any },
        },
      });
      if (existeBarras) {
        throw new ForbiddenException(
          `El código de barras "${data.codigoBarras}" ya está asignado a otro producto: ${existeBarras.descripcion}`,
        );
      }
      const existeAlterno = await this.prisma.productoCodigoBarras.findFirst({
        where: {
          empresaId: data.empresaId,
          codigo: data.codigoBarras,
          productoId: { not: data.id },
        },
        select: { producto: { select: { descripcion: true } } },
      });
      if (existeAlterno) {
        throw new ForbiddenException(
          `El código de barras "${data.codigoBarras}" ya está asignado a otro producto: ${existeAlterno.producto?.descripcion}`,
        );
      }
    }

    // Pre-validar códigos de barra adicionales ANTES de mutar el producto
    if (data.codigosBarrasExtra !== undefined) {
      await this.validarColisionCodigosExtra(
        data.empresaId,
        this.normalizarCodigosExtra(
          data.codigosBarrasExtra,
          data.codigoBarras ?? producto.codigoBarras,
        ),
        data.id,
      );
    }

    // Auto-calcular valorUnitario desde precioUnitario si se proporciona
    if (data.precioUnitario !== undefined) {
      const igv = data.igvPorcentaje ?? 18;
      // valorUnitario = precioUnitario / (1 + IGV%)
      data.valorUnitario = +(
        Number(data.precioUnitario) /
        (1 + igv / 100)
      ).toFixed(6);
    }

    // Si se actualizan porcentajes, validar que no rompan reservas ya existentes.
    if (
      !esServicio &&
      (data.porcentajeVenta !== undefined ||
        data.porcentajeProvision !== undefined)
    ) {
      const porcentajesNuevos = this.normalizarPorcentajes(
        data.porcentajeVenta,
        data.porcentajeProvision,
      );

      let sedeValidacionId = data.sedeId;
      if (!sedeValidacionId) {
        const sedePrincipal = await this.prisma.sede.findFirst({
          where: { empresaId: data.empresaId, esPrincipal: true },
          select: { id: true },
        });
        sedeValidacionId = sedePrincipal?.id;
      }

      if (sedeValidacionId) {
        const stockSede = await this.prisma.productoStock.findUnique({
          where: {
            productoId_sedeId: {
              productoId: data.id,
              sedeId: sedeValidacionId,
            },
          },
          select: { stock: true },
        });

        const stockBase = num(stockSede?.stock ?? producto.stock);
        const reservasActivas = await this.prisma.reserva.aggregate({
          where: {
            empresaId: data.empresaId,
            sedeId: sedeValidacionId,
            productoId: data.id,
            estado: { in: [EstadoReserva.PENDIENTE, EstadoReserva.CONFIRMADA] },
          },
          _sum: { cantidad: true },
        });
        const reservado = num(reservasActivas._sum.cantidad);
        const cupoProvision = Math.floor(
          (stockBase * porcentajesNuevos.porcentajeProvision) / 100,
        );

        if (reservado > cupoProvision) {
          throw new BadRequestException(
            `No se puede guardar: reservas activas (${reservado}) superan el nuevo cupo de provisión (${cupoProvision}). Ajusta reservas o porcentajes.`,
          );
        }
      }
    }

    // Si cambió el stock, registrar movimiento de kardex
    // NOTA: Para cambio de stock directo, se asume Sede Principal si no se especifica
    if (esServicio) {
      await this.prisma.productoStock.updateMany({
        where: { productoId: data.id },
        data: { stock: 0, stockMinimo: 0, stockMaximo: 0 },
      });
    } else if (data.stock !== undefined) {
      // Obtener sede principal por defecto si no viene en data
      let targetSedeId = data.sedeId;
      if (!targetSedeId) {
        const sedePrincipal = await this.prisma.sede.findFirst({
          where: { empresaId: data.empresaId, esPrincipal: true },
        });
        targetSedeId = sedePrincipal?.id;
      }

      if (targetSedeId) {
        // Obtener stock actual en esa sede
        const currentStock = await this.prisma.productoStock.findUnique({
          where: {
            productoId_sedeId: { productoId: data.id, sedeId: targetSedeId },
          },
        });

        if (currentStock && num(currentStock.stock) !== num(data.stock)) {
          const diferencia = round3(num(data.stock) - num(currentStock.stock));
          const esIngreso = diferencia > 0;
          const cantidad = round3(Math.abs(diferencia));

          try {
            await this.kardexService.registrarMovimiento({
              productoId: data.id,
              empresaId: data.empresaId,
              sedeId: targetSedeId,
              tipoMovimiento: esIngreso ? 'INGRESO' : 'SALIDA',
              concepto: `Ajuste manual de stock desde inventario (${esIngreso ? '+' : '-'}${cantidad})`,
              cantidad,
              costoUnitario: Number(producto.costoPromedio) || 0,
              usuarioId,
              observacion: `Stock anterior: ${currentStock.stock}, Stock nuevo: ${data.stock}`,
            });
          } catch (error) {
            console.error(
              'Error al registrar movimiento de kardex desde edición de producto:',
              error,
            );
          }
        }

        // Always update the actual stock in productoStock for this sede
        await this.prisma.productoStock.upsert({
          where: {
            productoId_sedeId: { productoId: data.id, sedeId: targetSedeId },
          },
          update: {
            stock: round3(num(data.stock)),
            ...(data.stockMinimo !== undefined
              ? { stockMinimo: data.stockMinimo }
              : {}),
            ...(data.stockMaximo !== undefined
              ? { stockMaximo: data.stockMaximo }
              : {}),
          },
          create: {
            productoId: data.id,
            sedeId: targetSedeId,
            stock: round3(num(data.stock)),
            stockMinimo: data.stockMinimo ?? 0,
            stockMaximo: data.stockMaximo ?? null,
          },
        });
      }
    }

    const debeActualizarPoliticaSede =
      data.sedeId &&
      (data.visibleEnSede !== undefined ||
        data.vendibleEnSede !== undefined ||
        data.precioUnitarioSede !== undefined ||
        data.precioOfertaSede !== undefined ||
        data.ubicacionSede !== undefined ||
        data.stockMinimo !== undefined ||
        data.stockMaximo !== undefined);

    if (debeActualizarPoliticaSede) {
      const sedePoliticaId = Number(data.sedeId);
      const sede = await this.prisma.sede.findFirst({
        where: { id: sedePoliticaId, empresaId: data.empresaId, activo: true },
        select: { id: true },
      });
      if (!sede) {
        throw new BadRequestException(
          'La sede indicada no pertenece a la empresa o no está activa',
        );
      }

      const updateSedeStock: any = {
        ...(data.visibleEnSede !== undefined
          ? { visibleEnSede: Boolean(data.visibleEnSede) }
          : {}),
        ...(data.vendibleEnSede !== undefined
          ? { vendibleEnSede: Boolean(data.vendibleEnSede) }
          : {}),
        ...(data.precioUnitarioSede !== undefined
          ? {
              precioUnitarioOverride:
                data.precioUnitarioSede === null
                  ? null
                  : new Decimal(data.precioUnitarioSede),
            }
          : {}),
        ...(data.precioOfertaSede !== undefined
          ? {
              precioOfertaOverride:
                data.precioOfertaSede === null
                  ? null
                  : new Decimal(data.precioOfertaSede),
            }
          : {}),
        ...(data.ubicacionSede !== undefined
          ? { ubicacion: data.ubicacionSede || null }
          : {}),
        ...(data.stockMinimo !== undefined
          ? { stockMinimo: data.stockMinimo }
          : {}),
        ...(data.stockMaximo !== undefined
          ? { stockMaximo: data.stockMaximo }
          : {}),
      };

      await this.prisma.productoStock.upsert({
        where: {
          productoId_sedeId: { productoId: data.id, sedeId: sedePoliticaId },
        },
        update: updateSedeStock,
        create: {
          productoId: data.id,
          sedeId: sedePoliticaId,
          stock: esServicio ? 0 : (data.stock ?? 0),
          stockMinimo: data.stockMinimo ?? 0,
          stockMaximo: data.stockMaximo ?? null,
          visibleEnSede: data.visibleEnSede ?? true,
          vendibleEnSede: data.vendibleEnSede ?? true,
          precioUnitarioOverride:
            data.precioUnitarioSede != null
              ? new Decimal(data.precioUnitarioSede)
              : null,
          precioOfertaOverride:
            data.precioOfertaSede != null
              ? new Decimal(data.precioOfertaSede)
              : null,
          ubicacion: data.ubicacionSede || null,
        },
      });
    }

    // "Disponible en": se aplica DESPUÉS de la política puntual de la sede
    // activa para que el listado explícito de sedes sea el que manda.
    if (Array.isArray(data.sedesDisponibles)) {
      await this.aplicarSedesDisponibles(
        data.id,
        data.empresaId,
        data.sedesDisponibles,
      );
    }

    const normalizePersistentImageUrl = (url: string) =>
      url.includes('amazonaws.com/') ? url.split('?')[0] : url;

    const imagenUrlUpdate =
      data.removerImagen === true
        ? null
        : typeof data.imagenUrl === 'string' && data.imagenUrl.trim()
          ? normalizePersistentImageUrl(data.imagenUrl.trim())
          : undefined;
    const normalizeOptionalDate = (value: string | Date | null | undefined) => {
      if (value === undefined) return undefined;
      if (value === null || value === '') return null;
      return new Date(value);
    };

    const actualizado = await this.prisma.producto.update({
      where: { id: data.id },
      data: {
        codigo: data.codigo !== undefined ? data.codigo : undefined,
        descripcion: data.descripcion,
        categoriaId:
          data.categoriaId === null
            ? null
            : data.categoriaId !== undefined && Number(data.categoriaId) > 0
              ? Number(data.categoriaId)
              : undefined,
        marcaId:
          data.marcaId === null
            ? null
            : data.marcaId !== undefined && Number(data.marcaId) > 0
              ? Number(data.marcaId)
              : undefined,
        unidadMedidaId: data.unidadMedidaId
          ? Number(data.unidadMedidaId)
          : undefined,
        tipoAfectacionIGV: data.tipoAfectacionIGV,
        moneda: data.moneda !== undefined ? data.moneda : undefined,
        valorUnitario:
          data.valorUnitario !== undefined
            ? new Decimal(data.valorUnitario)
            : undefined,
        igvPorcentaje:
          data.igvPorcentaje !== undefined
            ? new Decimal(data.igvPorcentaje)
            : undefined,
        precioUnitario:
          data.precioUnitario !== undefined
            ? new Decimal(data.precioUnitario)
            : undefined,
        imagenUrl: imagenUrlUpdate,
        publicarEnTienda:
          data.publicarEnTienda !== undefined
            ? data.publicarEnTienda
            : undefined,
        localizacion:
          data.localizacion !== undefined ? data.localizacion : undefined,
        ...(data.porcentajeVenta !== undefined ||
        data.porcentajeProvision !== undefined
          ? this.normalizarPorcentajes(
              data.porcentajeVenta,
              data.porcentajeProvision,
            )
          : {}),
        costoPromedio:
          data.costoUnitario !== undefined
            ? new Decimal(data.costoUnitario)
            : undefined,
        costoFijo:
          data.costoFijo !== undefined
            ? new Decimal(data.costoFijo)
            : undefined,
        comisionPorVenta:
          data.comisionPorVenta !== undefined
            ? new Decimal(data.comisionPorVenta)
            : undefined,
        comisionPorcentaje:
          data.comisionPorcentaje !== undefined
            ? new Decimal(data.comisionPorcentaje)
            : undefined,
        // stock: data.stock, // DEPRECATED: No actualizar stock global directamente aquí, se hace vía triggers o agregación
        stockMinimo:
          data.stockMinimo !== undefined ? data.stockMinimo : undefined,
        stockMaximo:
          data.stockMaximo !== undefined ? data.stockMaximo : undefined,
        // Campos Farmacia
        principioActivo: data.principioActivo,
        concentracion: data.concentracion,
        presentacion: data.presentacion,
        laboratorio: data.laboratorio,
        unidadCompra: data.unidadCompra,
        unidadVenta: data.unidadVenta,
        factorConversion: data.factorConversion
          ? Number(data.factorConversion)
          : undefined,
        codigoBarras: data.codigoBarras,
        codigoDigemid: data.codigoDigemid,
        codProdSunat: data.codProdSunat,
        // Campos farmacia booleanos
        requiereReceta:
          (data as any).requiereReceta !== undefined
            ? Boolean((data as any).requiereReceta)
            : undefined,
        controlado:
          (data as any).controlado !== undefined
            ? Boolean((data as any).controlado)
            : undefined,
        refrigerado:
          (data as any).refrigerado !== undefined
            ? Boolean((data as any).refrigerado)
            : undefined,
        // Campos Ofertas
        precioOferta:
          data.precioOferta !== undefined
            ? data.precioOferta === null
              ? null
              : new Decimal(data.precioOferta)
            : undefined,
        fechaInicioOferta: normalizeOptionalDate(data.fechaInicioOferta),
        fechaFinOferta: normalizeOptionalDate(data.fechaFinOferta),
        preciosMayorista:
          data.preciosMayorista !== undefined
            ? data.preciosMayorista
            : undefined,
        atributosTecnicos:
          data.atributosTecnicos !== undefined
            ? data.atributosTecnicos === null
              ? Prisma.JsonNull
              : data.atributosTecnicos
            : undefined,
        opcionesAtributos:
          data.opcionesAtributos !== undefined
            ? data.opcionesAtributos === null
              ? Prisma.JsonNull
              : data.opcionesAtributos
            : undefined,
        valoresAtributos:
          data.valoresAtributos !== undefined
            ? data.valoresAtributos === null
              ? Prisma.JsonNull
              : data.valoresAtributos
            : undefined,
        productoPadreId:
          data.productoPadreId !== undefined ? data.productoPadreId : undefined,
        descripcionLarga:
          data.descripcionLarga !== undefined
            ? data.descripcionLarga || null
            : undefined,
      },
    });

    if (actualizado.opcionesAtributos) {
      const sedesSync = await this.prisma.sede.findMany({
        where: { empresaId: data.empresaId, activo: true },
      });
      await sincronizarVariantes(
        this.prisma as any,
        actualizado,
        sedesSync,
        data.variantesConfig || [],
        data.sedeId,
      );
      await this.sincronizarDisponibilidadVariantes(actualizado.id);
    }

    await this.sincronizarCodigosBarrasExtra(
      actualizado.id,
      data.empresaId,
      data.codigosBarrasExtra,
      actualizado.codigoBarras,
    );

    return this.obtenerPorId(actualizado.id, data.empresaId);
  }

  // ==================== ASIGNACIÓN DE PRODUCTOS A SEDES ====================

  /**
   * Define en qué sedes está disponible un producto (visibleEnSede por sede).
   * No se puede quitar de una sede con stock > 0: primero trasladar/ajustar.
   */
  async aplicarSedesDisponibles(
    productoId: number,
    empresaId: number,
    sedesDisponibles: number[],
  ) {
    const sedes = await this.prisma.sede.findMany({
      where: { empresaId, activo: true },
      select: { id: true, nombre: true },
    });
    if (sedes.length === 0) return;
    const marcadas = new Set(sedesDisponibles.map((id) => Number(id)));
    if (!sedes.some((s) => marcadas.has(s.id))) {
      throw new BadRequestException(
        'El producto debe estar disponible en al menos una sede.',
      );
    }
    const stocks = await this.prisma.productoStock.findMany({
      where: { productoId },
      select: { sedeId: true, stock: true },
    });
    const stockPorSede = new Map(stocks.map((s) => [s.sedeId, num(s.stock)]));
    for (const sede of sedes) {
      const stockSede = stockPorSede.get(sede.id) ?? 0;
      if (!marcadas.has(sede.id) && stockSede > 0) {
        throw new BadRequestException(
          `No puedes quitar el producto de ${sede.nombre}: aún tiene ${stockSede} en stock. Traslada o ajusta el stock primero.`,
        );
      }
    }
    for (const sede of sedes) {
      const disponible = marcadas.has(sede.id);
      await this.prisma.productoStock.upsert({
        where: { productoId_sedeId: { productoId, sedeId: sede.id } },
        update: { visibleEnSede: disponible },
        create: {
          productoId,
          sedeId: sede.id,
          stock: 0,
          stockMinimo: 0,
          visibleEnSede: disponible,
        },
      });
    }
    await this.sincronizarDisponibilidadVariantes(productoId);
  }

  /** Sedes activas de la empresa con la disponibilidad y el stock del producto. */
  async sedesDeProducto(productoId: number, empresaId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    const [sedes, stocks] = await Promise.all([
      this.prisma.sede.findMany({
        where: { empresaId, activo: true },
        orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
        select: { id: true, nombre: true, esPrincipal: true, tipo: true },
      }),
      this.prisma.productoStock.findMany({
        where: { productoId },
        select: { sedeId: true, stock: true, visibleEnSede: true },
      }),
    ]);
    const porSede = new Map(stocks.map((s) => [s.sedeId, s]));
    return sedes.map((s) => {
      const st = porSede.get(s.id);
      return {
        sedeId: s.id,
        nombre: s.nombre,
        esPrincipal: s.esPrincipal,
        tipo: s.tipo,
        disponible: st ? st.visibleEnSede !== false : true,
        stock: num(st?.stock),
      };
    });
  }

  /**
   * Asigna (o quita) varios productos de una sede de golpe. Los que tienen
   * stock en la sede no se pueden quitar: se devuelven en `omitidos`.
   */
  async asignarSedeMasivo(
    empresaId: number,
    sedeId: number,
    productoIds: number[],
    disponible: boolean,
    opciones?: {
      /**
       * Al quitar: si el producto tiene stock en la sede, registrar una SALIDA
       * en kardex que lo deja en 0 y quitarlo igual. Pensado para el caso "se
       * cargó stock en la sede equivocada" — requiere confirmación explícita.
       */
      ajustarStockACero?: boolean;
      usuarioId?: number;
    },
  ) {
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId, activo: true },
      select: { id: true, nombre: true },
    });
    if (!sede) {
      throw new BadRequestException(
        'La sede indicada no pertenece a la empresa o no está activa',
      );
    }
    const ids = Array.from(new Set(productoIds.map((id) => Number(id)))).filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (ids.length === 0)
      return { actualizados: 0, ajustados: 0, omitidos: [], sede: sede.nombre };
    const productos = await this.prisma.producto.findMany({
      where: {
        id: { in: ids },
        empresaId,
        estado: { not: 'PLACEHOLDER' as any },
      },
      select: {
        id: true,
        descripcion: true,
        costoPromedio: true,
        stocks: { where: { sedeId }, select: { stock: true } },
      },
    });
    const omitidos: { id: number; descripcion: string; stock: number }[] = [];
    const aplicar: number[] = [];
    let ajustados = 0;
    for (const p of productos) {
      const stockSede = num(p.stocks[0]?.stock);
      if (!disponible && stockSede > 0) {
        if (opciones?.ajustarStockACero) {
          // Salida auditable en kardex: el stock de esa sede queda en 0.
          await this.kardexService.registrarMovimiento({
            productoId: p.id,
            empresaId,
            sedeId,
            tipoMovimiento: 'SALIDA',
            concepto: `Retiro de ${sede.nombre}: producto quitado de la sede (stock a 0)`,
            cantidad: round3(stockSede),
            costoUnitario: Number(p.costoPromedio) || 0,
            usuarioId: opciones.usuarioId,
            observacion: `Stock anterior: ${stockSede}, Stock nuevo: 0`,
          });
          ajustados += 1;
          aplicar.push(p.id);
        } else {
          omitidos.push({
            id: p.id,
            descripcion: p.descripcion,
            stock: stockSede,
          });
        }
      } else {
        aplicar.push(p.id);
      }
    }
    for (const productoId of aplicar) {
      await this.prisma.productoStock.upsert({
        where: { productoId_sedeId: { productoId, sedeId } },
        update: { visibleEnSede: disponible },
        create: {
          productoId,
          sedeId,
          stock: 0,
          stockMinimo: 0,
          visibleEnSede: disponible,
        },
      });
    }
    // Las variantes siguen al padre en esa sede.
    if (aplicar.length > 0) {
      await this.prisma.productoStock.updateMany({
        where: { sedeId, producto: { productoPadreId: { in: aplicar } } },
        data: { visibleEnSede: disponible },
      });
    }
    return {
      actualizados: aplicar.length,
      ajustados,
      omitidos,
      sede: sede.nombre,
    };
  }

  /**
   * Asigna un producto existente a una sede, opcionalmente con stock inicial
   * (ingreso registrado en Kardex). Es el camino para "ya existe en Ancón,
   * quiero venderlo también en Zapallal".
   */
  async asignarProductoASede(
    empresaId: number,
    productoId: number,
    sedeId: number,
    stockInicial?: number | null,
    usuarioId?: number,
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: {
        id: productoId,
        empresaId,
        estado: { not: 'PLACEHOLDER' as any },
      },
      select: { id: true, costoPromedio: true, atributosTecnicos: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId, activo: true },
      select: { id: true, nombre: true },
    });
    if (!sede) {
      throw new BadRequestException(
        'La sede indicada no pertenece a la empresa o no está activa',
      );
    }
    await this.marcarDisponibleEnSede(producto.id, sede.id);
    await this.sincronizarDisponibilidadVariantes(producto.id);
    const esServicio = this.esProductoServicio(
      producto.atributosTecnicos as any,
    );
    const cantidad = round3(Math.max(0, num(stockInicial ?? 0)));
    if (!esServicio && cantidad > 0) {
      await this.kardexService.registrarMovimiento({
        productoId: producto.id,
        empresaId,
        sedeId: sede.id,
        tipoMovimiento: 'INGRESO',
        concepto: `Asignación a ${sede.nombre} (stock inicial +${cantidad})`,
        cantidad,
        costoUnitario: Number(producto.costoPromedio) || 0,
        usuarioId,
      });
    }
    return this.obtenerPorId(producto.id, empresaId);
  }

  /**
   * Antes de crear: ¿ya existe un producto con ese código/código de barras?
   * Devuelve dónde está disponible para ofrecer "asignar a esta sede" en vez
   * de un error de duplicado.
   */
  async verificarCodigo(
    empresaId: number,
    codigo?: string,
    codigoBarras?: string,
    sedeId?: number,
  ) {
    const cod = (codigo ?? '').trim();
    const barras = (codigoBarras ?? '').trim();
    if (!cod && !barras) return { existe: false as const };
    const or: any[] = [];
    if (cod) or.push({ codigo: cod });
    if (barras) {
      or.push({ codigoBarras: barras });
      or.push({ codigosBarras: { some: { codigo: barras } } });
    }
    const producto = await this.prisma.producto.findFirst({
      where: { empresaId, estado: { not: 'PLACEHOLDER' as any }, OR: or },
      select: {
        id: true,
        codigo: true,
        codigoBarras: true,
        descripcion: true,
        precioUnitario: true,
        imagenUrl: true,
        estado: true,
      },
    });
    if (!producto) return { existe: false as const };
    const sedes = await this.sedesDeProducto(producto.id, empresaId);
    const enSede = sedeId
      ? sedes.find((s) => s.sedeId === Number(sedeId))
      : null;
    return {
      existe: true as const,
      producto: {
        ...producto,
        precioUnitario: Number(producto.precioUnitario),
        disponibleEnSede: enSede ? enSede.disponible : true,
        stockSede: enSede ? enSede.stock : null,
        sedes,
      },
    };
  }

  // ==================== IMÁGENES (S3) ====================

  async subirImagenPrincipal(
    empresaId: number,
    productoId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!file || !file.buffer)
      throw new ForbiddenException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct))
      throw new ForbiddenException('El archivo debe ser una imagen');

    const s3Key = this.s3.generateProductoImageKey(
      empresaId,
      productoId,
      ct,
      false,
    );
    const url = await this.s3.uploadImage(file.buffer, s3Key, ct);

    await this.prisma.producto.update({
      where: { id: productoId },
      data: { imagenUrl: url },
    });
    // Devolver también URL firmada para previsualización inmediata en admin
    const idx = url.indexOf('amazonaws.com/');
    const objKey =
      idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }

  // Sube la imagen UNA sola vez y la asigna a TODAS las variantes (tallas) del color.
  // Evita crear un archivo S3 por cada talla: una sola foto compartida por color.
  async subirImagenColorVariantes(
    empresaId: number,
    productoPadreId: number,
    color: string,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const padre = await this.prisma.producto.findFirst({
      where: { id: productoPadreId, empresaId },
    });
    if (!padre) throw new NotFoundException('Producto no encontrado');
    if (!file || !file.buffer)
      throw new ForbiddenException('Archivo no proporcionado');
    if (!color || !String(color).trim())
      throw new ForbiddenException('Color no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct))
      throw new ForbiddenException('El archivo debe ser una imagen');

    // Nombre de la opción de color (ej. "Color")
    const opciones = Array.isArray((padre as any).opcionesAtributos)
      ? ((padre as any).opcionesAtributos as any[])
      : [];
    const colorOption = opciones.find((op) =>
      /color|colour/i.test(String(op?.nombre || '')),
    );
    const colorKey = colorOption?.nombre || 'Color';
    const target = String(color).trim().toLowerCase();

    // Subir una sola vez (key bajo el producto padre)
    const s3Key = this.s3.generateProductoImageKey(
      empresaId,
      productoPadreId,
      ct,
      false,
    );
    const url = await this.s3.uploadImage(file.buffer, s3Key, ct);

    // Asignar la MISMA url a todas las variantes activas de ese color
    const variantes = await this.prisma.producto.findMany({
      where: { productoPadreId, empresaId },
      select: { id: true, valoresAtributos: true },
    });
    const idsDelColor = variantes
      .filter((v) => {
        const vals = (v.valoresAtributos as any) || {};
        return (
          String(vals[colorKey] || '')
            .trim()
            .toLowerCase() === target
        );
      })
      .map((v) => v.id);

    if (idsDelColor.length > 0) {
      await this.prisma.producto.updateMany({
        where: { id: { in: idsDelColor } },
        data: { imagenUrl: url },
      });
    }

    const idx = url.indexOf('amazonaws.com/');
    const objKey =
      idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl, variantesActualizadas: idsDelColor };
  }

  // Descarga una imagen desde una URL externa (ej. sugerencia de Serper/IA) y la
  // aplica a todas las variantes (tallas) del color, reutilizando la misma lógica
  // que la subida por archivo. Una sola foto S3 compartida por color.
  async subirImagenColorDesdeUrl(
    empresaId: number,
    productoPadreId: number,
    color: string,
    externalUrl: string,
  ) {
    if (!externalUrl || !String(externalUrl).trim())
      throw new ForbiddenException('URL no proporcionada');
    if (!color || !String(color).trim())
      throw new ForbiddenException('Color no proporcionado');

    let buffer: Buffer;
    let contentType: string;
    try {
      const axios = (await import('axios')).default;
      const response = await axios.get(externalUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      buffer = Buffer.from(response.data);
      contentType = response.headers['content-type'] || 'image/jpeg';
    } catch (error: any) {
      console.error('Error downloading color image from URL:', error?.message);
      throw new ForbiddenException(
        'Error al procesar la imagen desde la URL: ' + error?.message,
      );
    }

    if (!/^image\//i.test(contentType))
      throw new ForbiddenException('La URL no apunta a una imagen válida');

    // Reutiliza la lógica de subida + asignación por color.
    return this.subirImagenColorVariantes(empresaId, productoPadreId, color, {
      buffer,
      mimetype: contentType,
    });
  }

  // Descarga una imagen desde una URL externa y la sube a S3, devolviendo la URL S3.
  // NO modifica el producto: sirve para poblar galerías (por color) desde sugerencias IA.
  async importarImagenUrlAS3(
    empresaId: number,
    productoId: number,
    externalUrl: string,
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!externalUrl || !String(externalUrl).trim())
      throw new ForbiddenException('URL no proporcionada');

    try {
      const axios = (await import('axios')).default;
      const response = await axios.get(externalUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/jpeg';
      if (!contentType.startsWith('image/'))
        throw new ForbiddenException('La URL no apunta a una imagen válida');

      const s3Key = this.s3.generateProductoImageKey(
        empresaId,
        productoId,
        contentType,
        true,
      );
      const s3Url = await this.s3.uploadImage(buffer, s3Key, contentType);

      const idx = s3Url.indexOf('amazonaws.com/');
      const objKey =
        idx !== -1 ? s3Url.substring(idx + 'amazonaws.com/'.length) : '';
      const signedUrl = objKey
        ? await this.s3.getSignedGetUrl(objKey, 600)
        : s3Url;
      return { url: s3Url, signedUrl };
    } catch (error: any) {
      console.error('Error importing image from URL:', error?.message);
      throw new ForbiddenException(
        'Error al procesar la imagen desde la URL: ' + error?.message,
      );
    }
  }

  async subirImagenExtra(
    empresaId: number,
    productoId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!file || !file.buffer)
      throw new ForbiddenException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct))
      throw new ForbiddenException('El archivo debe ser una imagen');

    const key = this.s3.generateProductoImageKey(
      empresaId,
      productoId,
      ct,
      true,
    );
    const url = await this.s3.uploadImage(file.buffer, key, ct);

    const actuales = this.parseImagenesExtra((producto as any).imagenesExtra);
    const nuevas = [...actuales, url];
    await this.prisma.producto.update({
      where: { id: productoId },
      data: { imagenesExtra: JSON.stringify(nuevas) },
    });
    const idx = url.indexOf('amazonaws.com/');
    const objKey =
      idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }

  /** Máximo de imágenes extra (galería) permitido según el rubro de la empresa. */
  private async getMaxImagenesExtraEmpresa(empresaId: number): Promise<number> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId },
      select: { rubro: { select: { nombre: true } } },
    });
    return getMaxImagenesExtra(empresa?.rubro?.nombre ?? null);
  }

  /**
   * Reemplaza la galería de imágenes extra (para borrar/reordenar desde el
   * formulario de producto). Respeta el límite por rubro.
   */
  async setImagenesExtra(
    empresaId: number,
    productoId: number,
    imagenes: string[],
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const limpias = this.parseImagenesExtra(imagenes);
    const maxExtra = await this.getMaxImagenesExtraEmpresa(empresaId);
    if (limpias.length > maxExtra) {
      const maxTotal = maxExtra + 1;
      throw new ForbiddenException(
        `Máximo ${maxTotal} imágenes por producto (1 principal + ${maxExtra} adicionales) para tu rubro.`,
      );
    }
    await this.prisma.producto.update({
      where: { id: productoId },
      data: { imagenesExtra: limpias.length ? JSON.stringify(limpias) : null },
    });
    const signImagenesExtra = await Promise.all(
      limpias.map(async (u) => {
        const idx = u.indexOf('amazonaws.com/');
        const objKey =
          idx !== -1 ? u.substring(idx + 'amazonaws.com/'.length) : '';
        return objKey ? await this.s3.getSignedGetUrl(objKey, 600) : u;
      }),
    );
    return { imagenesExtra: limpias, imagenesExtraDisplay: signImagenesExtra };
  }

  /**
   * Agrega una imagen a la galería del producto respetando el límite por rubro.
   * Add-only (no sobrescribe): pensado para clientes simples como el móvil.
   */
  async agregarImagenGaleria(
    empresaId: number,
    productoId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!file || !file.buffer)
      throw new ForbiddenException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct))
      throw new ForbiddenException('El archivo debe ser una imagen');

    const actuales = this.parseImagenesExtra((producto as any).imagenesExtra);
    const maxExtra = await this.getMaxImagenesExtraEmpresa(empresaId);
    if (actuales.length >= maxExtra) {
      throw new ForbiddenException(
        `Máximo ${maxExtra + 1} imágenes por producto (1 principal + ${maxExtra} adicionales) para tu rubro.`,
      );
    }

    const key = this.s3.generateProductoImageKey(
      empresaId,
      productoId,
      ct,
      true,
    );
    const url = await this.s3.uploadImage(file.buffer, key, ct);
    await this.prisma.producto.update({
      where: { id: productoId },
      data: { imagenesExtra: JSON.stringify([...actuales, url]) },
    });
    const idx = url.indexOf('amazonaws.com/');
    const objKey =
      idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }

  /** Límite de imágenes (principal + galería) para exponer al frontend. */
  async getLimiteImagenes(empresaId: number) {
    const maxTotal = getMaxImagenesProducto(
      (
        await this.prisma.empresa.findFirst({
          where: { id: empresaId },
          select: { rubro: { select: { nombre: true } } },
        })
      )?.rubro?.nombre ?? null,
    );
    return { maxTotal, maxExtra: Math.max(0, maxTotal - 1) };
  }

  async subirImagenDesdeUrl(
    empresaId: number,
    productoId: number,
    externalUrl: string,
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!externalUrl) throw new ForbiddenException('URL no proporcionada');

    try {
      // Download the image from external URL
      const axios = (await import('axios')).default;
      const response = await axios.get(externalUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/jpeg';

      if (!contentType.startsWith('image/')) {
        throw new ForbiddenException('La URL no apunta a una imagen válida');
      }

      // Upload to S3
      const s3Key = this.s3.generateProductoImageKey(
        empresaId,
        productoId,
        contentType,
        false,
      );
      const s3Url = await this.s3.uploadImage(buffer, s3Key, contentType);

      // Update product with S3 URL
      await this.prisma.producto.update({
        where: { id: productoId },
        data: { imagenUrl: s3Url },
      });

      // Return signed URL for immediate use
      const idx = s3Url.indexOf('amazonaws.com/');
      const objKey =
        idx !== -1 ? s3Url.substring(idx + 'amazonaws.com/'.length) : '';
      const signedUrl = objKey
        ? await this.s3.getSignedGetUrl(objKey, 600)
        : s3Url;

      return { url: s3Url, signedUrl };
    } catch (error: any) {
      console.error(
        'Error downloading/uploading image from URL:',
        error.message,
      );
      throw new ForbiddenException(
        'Error al procesar la imagen desde la URL: ' + error.message,
      );
    }
  }

  async cambiarEstado(id: number, empresaId: number, estado: EstadoType) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return this.prisma.producto.update({ where: { id }, data: { estado } });
  }

  async togglePublicarEnTienda(
    id: number,
    empresaId: number,
    publicar: boolean,
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return this.prisma.producto.update({
      where: { id },
      data: { publicarEnTienda: publicar },
      select: { id: true, descripcion: true, publicarEnTienda: true },
    });
  }

  async eliminar(id: number, empresaId: number) {
    const producto = await this.prisma.producto.findFirst({
      where: { id, empresaId },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    return this.prisma.producto.update({
      where: { id },
      data: {
        estado: 'PLACEHOLDER' as any,
        publicarEnTienda: false as any,
      },
    });
  }

  async eliminarTodo(empresaId: number, sedeId?: number) {
    const productosDelSistema = ['PLD', 'IPM', 'DGD'];

    if (sedeId) {
      // Sede-scoped delete:
      // 1. Remove all ProductoStock records for this sede
      await this.prisma.productoStock.deleteMany({
        where: {
          sedeId,
          producto: { empresaId },
        },
      });

      // 2. Mark as PLACEHOLDER any productos that now have no ProductoStock
      //    at any sede (they were exclusively in this sede)
      const huerfanos = await this.prisma.producto.findMany({
        where: {
          empresaId,
          codigo: { notIn: productosDelSistema },
          estado: { not: 'PLACEHOLDER' as any },
          stocks: { none: {} },
        },
        select: { id: true },
      });

      let count = 0;
      if (huerfanos.length > 0) {
        const res = await this.prisma.producto.updateMany({
          where: { id: { in: huerfanos.map((p) => p.id) } },
          data: {
            estado: 'PLACEHOLDER' as any,
            publicarEnTienda: false as any,
          },
        });
        count = res.count;
      }

      return { count };
    }

    // Empresa-wide: mark all products as PLACEHOLDER
    const result = await this.prisma.producto.updateMany({
      where: {
        empresaId,
        codigo: { notIn: productosDelSistema },
        estado: { not: 'PLACEHOLDER' as any },
      },
      data: {
        estado: 'PLACEHOLDER' as any,
        publicarEnTienda: false as any,
      },
    });
    return result;
  }

  async obtenerSiguienteCodigo(empresaId: number, prefijo = 'PR') {
    return this.generarCodigoProducto(empresaId, prefijo);
  }

  async getSedePrincipalId(empresaId: number): Promise<number> {
    const sede = await this.prisma.sede.findFirst({
      where: { empresaId, esPrincipal: true },
    });
    return sede?.id || 0; // Return 0 or handle error if no sede found (though database should have one)
  }

  private normalizarTextoImagen(texto?: string): string {
    const raw = String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const aliases: Record<string, string> = {
      qatey: 'oatey',
    };

    return raw
      .split(' ')
      .map((t) => aliases[t] || t)
      .filter((t) => t.length >= 2)
      .join(' ');
  }

  private construirClavesBusquedaImagen(
    nombre: string,
    marca?: string,
    categoria?: string,
  ): string[] {
    const nombreNorm = this.normalizarTextoImagen(nombre);
    const marcaNorm = this.normalizarTextoImagen(marca);
    const categoriaNorm = this.normalizarTextoImagen(categoria);

    if (!nombreNorm) return [];

    const claves = [
      [nombreNorm, marcaNorm, categoriaNorm].filter(Boolean).join('|'),
      [nombreNorm, marcaNorm].filter(Boolean).join('|'),
      [nombreNorm, categoriaNorm].filter(Boolean).join('|'),
      nombreNorm,
    ].filter(Boolean);

    return Array.from(new Set(claves));
  }

  async buscarImagenMemorizada(
    empresaId: number,
    nombre: string,
    marca?: string,
    categoria?: string,
  ): Promise<{ url: string; clave: string } | null> {
    const claves = this.construirClavesBusquedaImagen(nombre, marca, categoria);
    if (claves.length === 0) return null;

    for (const claveBusqueda of claves) {
      const match = await this.prisma.imagenProductoAprobadaIa.findUnique({
        where: {
          empresaId_claveBusqueda: {
            empresaId,
            claveBusqueda,
          },
        },
      });

      if (match?.imagenUrl) {
        await this.prisma.imagenProductoAprobadaIa.update({
          where: { id: match.id },
          data: {
            vecesUsada: { increment: 1 },
            ultimoUsoEn: new Date(),
          },
        });
        return { url: match.imagenUrl, clave: claveBusqueda };
      }
    }

    return null;
  }

  async guardarImagenMemorizada(params: {
    empresaId: number;
    nombre: string;
    marca?: string;
    categoria?: string;
    url: string;
  }) {
    const url = String(params.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException('La URL de imagen no es válida.');
    }

    const nombreNorm = this.normalizarTextoImagen(params.nombre);
    if (!nombreNorm) {
      throw new BadRequestException(
        'El nombre del producto es obligatorio para memorizar imagen.',
      );
    }

    const marcaNorm = this.normalizarTextoImagen(params.marca);
    const categoriaNorm = this.normalizarTextoImagen(params.categoria);
    const claves = this.construirClavesBusquedaImagen(
      params.nombre,
      params.marca,
      params.categoria,
    );

    let principal: Prisma.ImagenProductoAprobadaIaGetPayload<
      Record<string, never>
    > | null = null;
    for (const claveBusqueda of claves) {
      const saved = await this.prisma.imagenProductoAprobadaIa.upsert({
        where: {
          empresaId_claveBusqueda: {
            empresaId: params.empresaId,
            claveBusqueda,
          },
        },
        create: {
          empresaId: params.empresaId,
          claveBusqueda,
          nombreNorm,
          marcaNorm: marcaNorm || null,
          categoriaNorm: categoriaNorm || null,
          imagenUrl: url,
          vecesUsada: 1,
          ultimoUsoEn: new Date(),
        },
        update: {
          imagenUrl: url,
          nombreNorm,
          marcaNorm: marcaNorm || null,
          categoriaNorm: categoriaNorm || null,
          ultimoUsoEn: new Date(),
          vecesUsada: { increment: 1 },
        },
      });

      if (!principal) principal = saved;
    }

    return principal;
  }

  async exportar(
    empresaId: number,
    search?: string,
    sedeId?: number,
  ): Promise<Buffer> {
    const productosDelSistema = ['PLD', 'IPM', 'DGD'];

    const where: any = {
      empresaId,
      estado: { in: [EstadoType.ACTIVO, EstadoType.INACTIVO] },
      codigo: { notIn: productosDelSistema },
      OR: search
        ? [
            { descripcion: { contains: search, mode: 'insensitive' } },
            { codigo: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
      // Por sede: solo lo disponible en ella (misma regla que `listar`).
      ...(sedeId
        ? {
            NOT: {
              stocks: {
                some: { sedeId: Number(sedeId), visibleEnSede: false },
              },
            },
          }
        : {}),
    };

    const productos = await this.prisma.producto.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        unidadMedida: true,
        categoria: true,
        marca: true,
        // Cuando se pide una sede concreta, traer solo su stock; si no
        // ("Todas las sedes"), traer el stock de todas para sumarlo y
        // para armar la columna de ubicaciones por almacén.
        stocks: {
          where: sedeId ? { sedeId: Number(sedeId) } : undefined,
          include: { sede: { select: { nombre: true } } },
        },
        lotes: {
          where: { activo: true, stockActual: { gt: 0 } },
          select: { stockActual: true },
        },
      },
    });

    const datosExcel: Record<string, any>[] = productos.map((producto) => {
      const p: any = producto;
      const stockDesdeLotes = (p.lotes || []).reduce(
        (acc: number, lote: any) => acc + Number(lote.stockActual || 0),
        0,
      );
      const usaStockLotes = stockDesdeLotes > 0;
      const stockTotalBase = sedeId
        ? num(p.stocks?.[0]?.stock)
        : p.stocks?.length > 0
          ? p.stocks.reduce((sum: number, s: any) => sum + num(s.stock), 0)
          : num(p.stock);
      const stockTotal =
        usaStockLotes && !sedeId ? stockDesdeLotes : stockTotalBase;
      const stockMinimo = sedeId
        ? (p.stocks?.[0]?.stockMinimo ?? 0)
        : p.stocks?.length > 0
          ? p.stocks.reduce(
              (sum: number, s: any) => sum + (s.stockMinimo || 0),
              0,
            )
          : (p.stockMinimo ?? 0);
      // Costo "de bolsillo" (CON IGV) — misma regla que la tabla de productos y
      // el KPI de resumen: lo que el empresario pagó, no el neto contable.
      const costoNeto = Number(p.costoPromedio ?? 0);
      const esGravadoExport = String(p.tipoAfectacionIGV ?? '10') === '10';
      const costo = esGravadoExport
        ? Math.round(costoNeto * 1.18 * 100) / 100
        : costoNeto;
      const valorInventario = Math.round(stockTotal * costo * 100) / 100;
      const ubicaciones = (p.stocks || [])
        .filter((s: any) => Number(s.stock) > 0 || s.ubicacion)
        .map((s: any) => {
          const nombreSede = s.sede?.nombre || `Sede ${s.sedeId}`;
          return s.ubicacion ? `${nombreSede}: ${s.ubicacion}` : nombreSede;
        })
        .join(' | ');

      return {
        CÓDIGO: producto.codigo,
        'CÓDIGO DE BARRAS': p?.codigoBarras || '',
        PRODUCTO: producto.descripcion,
        'U.M': producto.unidadMedida?.nombre || '',
        AFECT: producto.tipoAfectacionIGV,
        'PRECIO UNITARIO CON IGV': Number(producto.precioUnitario),
        'COSTO CON IGV': costo,
        IGV: Number(producto.igvPorcentaje),
        STOCK: stockTotal,
        'VALOR INVENTARIO': valorInventario,
        'STOCK MINIMO': stockMinimo,
        CATEGORIA: producto.categoria?.nombre || '',
        MARCA: p?.marca?.nombre || '',
        UBICACIONES: ubicaciones || '-',
      };
    });

    const totalStock = datosExcel.reduce(
      (sum, r) => sum + Number(r.STOCK || 0),
      0,
    );
    const totalValorInventario =
      Math.round(
        datosExcel.reduce(
          (sum, r) => sum + Number(r['VALOR INVENTARIO'] || 0),
          0,
        ) * 100,
      ) / 100;
    datosExcel.push({
      CÓDIGO: '',
      'CÓDIGO DE BARRAS': '',
      PRODUCTO: 'TOTAL',
      'U.M': '',
      AFECT: '',
      'PRECIO UNITARIO CON IGV': '',
      'COSTO CON IGV': '',
      IGV: '',
      STOCK: totalStock,
      'VALOR INVENTARIO': totalValorInventario,
      'STOCK MINIMO': '',
      CATEGORIA: '',
      MARCA: '',
      UBICACIONES: '',
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
    worksheet['!cols'] = [
      { wch: 18 }, // CÓDIGO
      { wch: 20 }, // CÓDIGO DE BARRAS
      { wch: 100 }, // PRODUCTO
      { wch: 20 }, // U.M
      { wch: 10 }, // AFECT
      { wch: 22 }, // PRECIO UNITARIO CON IGV
      { wch: 20 }, // COSTO CON IGV
      { wch: 8 }, // IGV
      { wch: 10 }, // STOCK
      { wch: 18 }, // VALOR INVENTARIO
      { wch: 13 }, // STOCK MINIMO
      { wch: 20 }, // CATEGORIA
      { wch: 20 }, // MARCA
      { wch: 40 }, // UBICACIONES
    ];

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    return buffer;
  }

  async plantilla(): Promise<Buffer> {
    const filas = [
      {
        CÓDIGO: 'PR001',
        'CÓDIGO DE BARRAS': '',
        PRODUCTO: 'Producto sin código de barras (SKU manual)',
        'U.M': 'Unidad (bienes)',
        AFECT: '10',
        'PRECIO UNITARIO CON IGV': 10.0,
        'COSTO CON IGV': 6.0,
        IGV: 18,
        STOCK: 100,
        'STOCK MINIMO': 10,
        CATEGORIA: 'General',
        MARCA: '',
      },
      {
        CÓDIGO: 'PR002',
        'CÓDIGO DE BARRAS': '7750243072366',
        PRODUCTO: 'Producto con código de barras EAN-13',
        'U.M': 'Unidad (bienes)',
        AFECT: '10',
        'PRECIO UNITARIO CON IGV': 25.5,
        'COSTO CON IGV': 15.0,
        IGV: 18,
        STOCK: 50,
        'STOCK MINIMO': 5,
        CATEGORIA: 'Abarrotes',
        MARCA: 'Ejemplo',
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet(filas);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
    worksheet['!cols'] = [
      { wch: 18 }, // CÓDIGO
      { wch: 20 }, // CÓDIGO DE BARRAS
      { wch: 50 }, // PRODUCTO
      { wch: 12 }, // U.M
      { wch: 8 }, // AFECT
      { wch: 22 }, // PRECIO UNITARIO CON IGV
      { wch: 20 }, // COSTO CON IGV
      { wch: 6 }, // IGV
      { wch: 8 }, // STOCK
      { wch: 13 }, // STOCK MINIMO
      { wch: 20 }, // CATEGORIA
      { wch: 20 }, // MARCA
    ];

    const instrucciones = [
      {
        Columna: 'AFECT',
        Código: '10',
        Significado:
          'Gravado (paga IGV) — el más común, úsalo si no estás seguro',
      },
      {
        Columna: 'AFECT',
        Código: '20',
        Significado: 'Exonerado (no paga IGV)',
      },
      {
        Columna: 'AFECT',
        Código: '30',
        Significado: 'Inafecto (no paga IGV por ley)',
      },
      { Columna: 'AFECT', Código: '40', Significado: 'Exportación' },
    ];
    const hojaInstrucciones = XLSX.utils.json_to_sheet(instrucciones);
    hojaInstrucciones['!cols'] = [
      { wch: 10 }, // Columna
      { wch: 8 }, // Código
      { wch: 60 }, // Significado
    ];
    XLSX.utils.book_append_sheet(workbook, hojaInstrucciones, 'Instrucciones');

    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  }

  private normClave(s: string): string {
    return s
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private resolverUmbSunat(raw: string | undefined): string {
    const alias: Record<string, string> = {
      KG: 'KGM',
      KGS: 'KGM',
      KILO: 'KGM',
      KILOGRAMO: 'KGM',
      UN: 'NIU',
      UND: 'NIU',
      UNID: 'NIU',
      UNIDAD: 'NIU',
      'UNIDAD (BIENES)': 'NIU',
      'UNIDAD (SERVICIOS)': 'ZZ',
      SERVICIO: 'ZZ',
      ETIQ: 'NIU',
      PZA: 'NIU',
      PZ: 'NIU',
      LT: 'LTR',
      LTS: 'LTR',
      LITRO: 'LTR',
      MT: 'MTR',
      MTS: 'MTR',
      METRO: 'MTR',
      GALON: 'GLL',
      GALONES: 'GLL',
      GL: 'GLL',
      KILOS: 'KGM',
      GRAMO: 'GRM',
      GRAMOS: 'GRM',
      GR: 'GRM',
      MILILITRO: 'MLT',
      ML: 'MLT',
      CAJA: 'BX',
      CJ: 'BX',
      BOLSA: 'BG',
      ROLLO: 'ROL',
      PAR: 'NIU',
      PARES: 'NIU',
      BLISTER: 'NIU',
      PAQUETE: 'NIU',
      PAQ: 'NIU',
      DOCENA: 'NIU',
    };
    if (!raw) return 'NIU';
    const key = raw.trim().toUpperCase();
    return alias[key] ?? key;
  }

  private leerFilasMultiHoja(workbook: XLSX.WorkBook): any[] {
    const rows: any[] = [];

    const hdrIdx = (filas: any[][], marcas: string[]): number => {
      for (let i = 0; i < Math.min(filas.length, 5); i++) {
        if (marcas.some((m) => filas[i].includes(m))) return i;
      }
      return -1;
    };

    const sheetInsumos = workbook.Sheets['INV.INSUM.'];
    if (sheetInsumos) {
      const filas = XLSX.utils.sheet_to_json(sheetInsumos, {
        header: 1,
      }) as any[][];
      const hi = hdrIdx(filas, ['SKU', 'NOMBRES']);
      if (hi >= 0) {
        const h = filas[hi];
        const skuI = h.indexOf('SKU');
        const nomI = h.indexOf('NOMBRES');
        const precioKgI = h.indexOf('Precio x kg');
        const costoI = h.indexOf('Costo sin igv');
        const invI = h.indexOf('Inventario');
        const familiaI = h.findIndex(
          (x: any) => x && String(x).toUpperCase() === 'FAMILIA',
        );
        for (let i = hi + 1; i < filas.length; i++) {
          const f = filas[i];
          if (!f[skuI] || !f[nomI]) continue;
          rows.push({
            CÓDIGO: String(f[skuI]),
            PRODUCTO: String(f[nomI]),
            'U.M': 'KGM',
            AFECT: '10',
            'PRECIO UNITARIO':
              precioKgI >= 0
                ? (f[precioKgI] ?? 0)
                : costoI >= 0
                  ? (f[costoI] ?? 0)
                  : 0,
            'PRECIO COSTO': costoI >= 0 ? (f[costoI] ?? 0) : 0,
            STOCK: invI >= 0 ? (f[invI] ?? 0) : 0,
            CATEGORIA:
              familiaI >= 0 && f[familiaI] ? String(f[familiaI]) : undefined,
          });
        }
      }
    }

    const sheetEtiq = workbook.Sheets['INV. ETIQ.'];
    if (sheetEtiq) {
      const filas = XLSX.utils.sheet_to_json(sheetEtiq, {
        header: 1,
      }) as any[][];
      const hi = hdrIdx(filas, ['COD.', 'NOMBRES']);
      if (hi >= 0) {
        const h = filas[hi];
        const codI = h.indexOf('COD.');
        const nomI = h.indexOf('NOMBRES');
        const costoI = h.indexOf('COSTO SIN IGV');
        const umbI = h.indexOf('UMB');
        const invI = h.findIndex(
          (x: any) => x && String(x).toLowerCase().startsWith('inventario'),
        );
        for (let i = hi + 1; i < filas.length; i++) {
          const f = filas[i];
          if (!f[codI] || !f[nomI]) continue;
          const umbRaw =
            umbI >= 0 && f[umbI] ? String(f[umbI]).toUpperCase() : undefined;
          rows.push({
            CÓDIGO: String(f[codI]),
            PRODUCTO: String(f[nomI]),
            'U.M': this.resolverUmbSunat(umbRaw),
            AFECT: '10',
            'PRECIO UNITARIO': costoI >= 0 ? (f[costoI] ?? 0) : 0,
            STOCK: invI >= 0 ? (f[invI] ?? 0) : 0,
          });
        }
      }
    }

    const sheetPT = workbook.Sheets['INVE. PT'];
    if (sheetPT) {
      const filas = XLSX.utils.sheet_to_json(sheetPT, { header: 1 }) as any[][];
      const hi = hdrIdx(filas, ['COD.', 'NOMBRES']);
      if (hi >= 0) {
        const h = filas[hi];
        const codI = h.indexOf('COD.');
        const nomI = h.indexOf('NOMBRES');
        const costoUniI = h.indexOf('COSTO UNI.');
        const costoI = h.indexOf('COSTO');
        const umbI = h.indexOf('UMB');
        const invI = h.indexOf('Inventario');
        for (let i = hi + 1; i < filas.length; i++) {
          const f = filas[i];
          if (!f[codI] || !f[nomI]) continue;
          const umbRaw =
            umbI >= 0 && f[umbI] ? String(f[umbI]).toUpperCase() : undefined;
          rows.push({
            CÓDIGO: String(f[codI]),
            PRODUCTO: String(f[nomI]),
            'U.M': this.resolverUmbSunat(umbRaw),
            AFECT: '10',
            'PRECIO UNITARIO': costoI >= 0 ? (f[costoI] ?? 0) : 0,
            'PRECIO COSTO': costoUniI >= 0 ? (f[costoUniI] ?? 0) : 0,
            STOCK: invI >= 0 ? (f[invI] ?? 0) : 0,
          });
        }
      }
    }

    // Deduplicar por código (mantener primera aparición)
    const seen = new Set<string>();
    return rows.filter((r) => {
      const cod = String(r['CÓDIGO']).trim();
      if (!cod || seen.has(cod)) return false;
      seen.add(cod);
      return true;
    });
  }

  async cargaMasiva(
    fileBuffer: Buffer,
    empresaId: number,
    sedeId?: number,
    usuarioId?: number,
  ) {
    // Resolver sede destino: el stock del Excel se aplica a un almacén concreto.
    // Se exige una sede específica para no cargar stock en la sede equivocada.
    if (!sedeId) {
      throw new ForbiddenException(
        'Debe seleccionar un almacén/sede específico para importar el stock.',
      );
    }
    const sedeDestino = await this.prisma.sede.findFirst({
      where: { id: Number(sedeId), empresaId, activo: true },
      select: { id: true },
    });
    if (!sedeDestino) {
      throw new ForbiddenException(
        'La sede/almacén indicado no pertenece a la empresa o no está activo.',
      );
    }
    const sedeDestinoId = sedeDestino.id;

    const unidades = await this.prisma.unidadMedida.findMany({
      select: { id: true, nombre: true, codigo: true },
    });
    const unidadMap = new Map<string, number>();
    for (const u of unidades) {
      unidadMap.set(this.normClave(u.nombre), u.id);
      if (u.codigo) unidadMap.set(this.normClave(u.codigo), u.id);
    }

    const categorias = await this.prisma.categoria.findMany({
      select: { id: true, nombre: true },
    });
    const categoriaMap = new Map(
      categorias.map((c) => [this.normClave(c.nombre), c.id]),
    );

    const marcas = await this.prisma.marca.findMany({
      where: { empresaId },
      select: { id: true, nombre: true },
    });
    const marcaMap = new Map(
      marcas.map((m) => [this.normClave(m.nombre), m.id]),
    );

    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

    let rows: any[];
    if (
      workbook.Sheets['INV.INSUM.'] ||
      workbook.Sheets['INV. ETIQ.'] ||
      workbook.Sheets['INVE. PT']
    ) {
      rows = this.leerFilasMultiHoja(workbook);
    } else {
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    }

    if (rows.length === 0)
      throw new ForbiddenException('El archivo Excel está vacío');

    const resultados: {
      producto?: any;
      error?: string;
      actualizado?: boolean;
    }[] = [];
    const tiposValidos = ['10', '20', '30', '40'];

    for (const [index, row] of rows.entries()) {
      try {
        const codigo = row['CÓDIGO'] ?? row['Código'] ?? row['codigo'] ?? null;
        // Columna nueva y separada para el código de barras (EAN/UPC). Si viene con
        // valor, manda sobre la detección automática del CÓDIGO (retrocompatible:
        // si está vacía, se usa la lógica antigua de detectar EAN en CÓDIGO).
        const codigoBarrasColRaw =
          row['CÓDIGO DE BARRAS'] ??
          row['CODIGO DE BARRAS'] ??
          row['Código de Barras'] ??
          row['Codigo de Barras'] ??
          row['codigoBarras'] ??
          null;
        const codigoBarrasExplicito =
          codigoBarrasColRaw != null && String(codigoBarrasColRaw).trim() !== ''
            ? String(codigoBarrasColRaw).trim()
            : null;
        const descripcion =
          row['PRODUCTO'] ?? row['Producto'] ?? row['producto'] ?? null;
        const unidadNombre =
          row['U.M'] ??
          row['U.M.'] ??
          row['Unidad de Medida'] ??
          row['unidadMedida'] ??
          null;
        const afectRaw = row['AFECT'] ?? row['Afect'] ?? row['afect'] ?? null;
        const precioUnitarioRaw =
          row['PRECIO UNITARIO CON IGV'] ??
          row['PRECIO UNITARIO'] ??
          row['Precio Unitario'] ??
          row['precioUnitario'] ??
          null;
        // Columna nueva (round-trip con el export): el costo viene CON IGV, tal
        // como lo piensa el empresario; se convierte a neto al guardar.
        const costoConIgvRaw =
          row['COSTO CON IGV'] ??
          row['Costo con IGV'] ??
          row['costoConIgv'] ??
          null;
        // Columnas legacy: el costo viene NETO (sin IGV), se guarda tal cual.
        const precioCostoRaw =
          row['COSTO COMPRA SIN IGV'] ??
          row['COSTO COMPRA'] ??
          row['Costo Compra'] ??
          row['costoCompra'] ??
          row['PRECIO COSTO'] ??
          row['Precio Costo'] ??
          null;
        const stockMinimoRaw =
          row['STOCK MINIMO'] ??
          row['STOCK MÍNIMO'] ??
          row['Stock Mínimo'] ??
          row['Stock Minimo'] ??
          row['stockMinimo'] ??
          null;
        const igvRaw = row['IGV'] ?? row['igv'] ?? null;
        const stockRaw = row['STOCK'] ?? row['Stock'] ?? row['stock'] ?? null;
        const categoriaRaw =
          row['CATEGORIA'] ?? row['Categoría'] ?? row['categoria'] ?? null;
        const marcaRaw = row['MARCA'] ?? row['Marca'] ?? row['marca'] ?? null;
        if (!codigo)
          throw new ForbiddenException(
            `Código no proporcionado en la fila ${index + 1}`,
          );
        if (!descripcion)
          throw new ForbiddenException(
            `Descripción no proporcionada en la fila ${index + 1}`,
          );
        if (!unidadNombre)
          throw new ForbiddenException(
            `Unidad de medida no proporcionada en la fila ${index + 1}`,
          );

        // Si CÓDIGO es solo dígitos de 8-14 chars → puede ser un código de barras EAN/UPC.
        // La decisión de codigoFinal/codigoBarras se toma tras conocer si el producto
        // ya existe (más abajo), para no romper el round-trip export→import.
        const codigoRaw = codigo.toString().trim();
        const esBarcode = /^\d{8,14}$/.test(codigoRaw);

        const unidadKey = unidadNombre
          .toString()
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        // 1) match directo por nombre/código; 2) fallback: normalizar a código SUNAT
        // (ej. "Unidad (bienes)" -> NIU) y buscar por ese código.
        let unidadMedidaId = unidadMap.get(unidadKey);
        if (!unidadMedidaId) {
          const codigoSunat = this.resolverUmbSunat(unidadNombre.toString());
          unidadMedidaId = unidadMap.get(this.normClave(codigoSunat));
        }
        // Última red: unidades libres del cliente ("SET X", "CUARTO DC", etc.)
        // caen a Unidad (NIU) para no perder el producto en la importación.
        if (!unidadMedidaId) {
          unidadMedidaId = unidadMap.get('NIU');
        }
        if (!unidadMedidaId)
          throw new ForbiddenException(
            `Unidad de medida no válida (${unidadNombre}) en la fila ${index + 1}`,
          );

        let tipoAfectacionIGV = afectRaw ? afectRaw.toString().trim() : '10';
        if (!tiposValidos.includes(tipoAfectacionIGV)) {
          const n = parseInt(tipoAfectacionIGV, 10);
          tipoAfectacionIGV = tiposValidos.includes(n.toString())
            ? n.toString()
            : '10';
        }

        const precioUnitario = parseFloat(precioUnitarioRaw?.toString());
        // Prioriza la columna nueva CON IGV (se des-agrega el IGV con 4 decimales
        // para que el round-trip export→import→export no pierda centavos);
        // cae a las legacy que ya vienen en neto.
        const esGravadoImport = tipoAfectacionIGV === '10';
        const costoPromedio =
          costoConIgvRaw != null && costoConIgvRaw.toString().trim() !== ''
            ? esGravadoImport
              ? parseFloat(
                  (parseFloat(costoConIgvRaw.toString()) / 1.18).toFixed(4),
                )
              : parseFloat(costoConIgvRaw.toString())
            : precioCostoRaw != null
              ? parseFloat(precioCostoRaw.toString())
              : undefined;
        const stockMinimoImport =
          stockMinimoRaw != null && stockMinimoRaw.toString().trim() !== ''
            ? parseInt(stockMinimoRaw.toString(), 10)
            : undefined;
        const stock = parseInt(stockRaw?.toString(), 10);
        const igvPorcentaje = igvRaw ? parseFloat(igvRaw.toString()) : 18;

        // Auto-upsert category: create if it doesn't exist
        let categoriaId: number | undefined;
        if (categoriaRaw) {
          const categoriaKey = categoriaRaw
            .toString()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          let id = categoriaMap.get(categoriaKey);
          if (!id) {
            const nueva = await this.prisma.categoria.create({
              data: { nombre: String(categoriaRaw).trim(), empresaId },
            });
            id = nueva.id;
            categoriaMap.set(categoriaKey, id);
          }
          categoriaId = id;
        }

        // Auto-upsert marca: crear si no existe (por empresa)
        let marcaId: number | undefined;
        if (marcaRaw != null && String(marcaRaw).trim() !== '') {
          const marcaNombre = String(marcaRaw).trim();
          const marcaKey = this.normClave(marcaNombre);
          let id = marcaMap.get(marcaKey);
          if (!id) {
            const nueva = await this.prisma.marca.create({
              data: { nombre: marcaNombre, empresaId },
            });
            id = nueva.id;
            marcaMap.set(marcaKey, id);
          }
          marcaId = id;
        }

        // Upsert: buscar por SKU (codigo) O por código de barras. Buscar por AMBOS
        // evita duplicar en el round-trip export→import cuando el valor numérico de
        // la columna CÓDIGO corresponde en realidad al `codigo` del producto (no a un
        // código de barras) — p. ej. variantes con código numérico y sin barcode.
        const existe = await this.prisma.producto.findFirst({
          where: {
            empresaId,
            estado: { not: 'PLACEHOLDER' as any },
            OR: [
              { codigo: codigoRaw },
              { codigoBarras: codigoRaw },
              ...(codigoBarrasExplicito
                ? [{ codigoBarras: codigoBarrasExplicito }]
                : []),
            ],
          },
          select: {
            id: true,
            opcionesAtributos: true,
            codigo: true,
            codigoBarras: true,
          },
        });

        // Resolver código final y código de barras según si el producto ya existe.
        let codigoFinal: string;
        let codigoBarras: string | undefined;
        if (existe) {
          // No regenerar el código de un producto existente.
          codigoFinal = existe.codigo;
          if (codigoBarrasExplicito) {
            // La columna nueva manda: se asigna/actualiza el barcode indicado.
            codigoBarras = codigoBarrasExplicito;
          } else {
            // Legacy: solo asignar el barcode si el número del CÓDIGO es un EAN
            // nuevo para este producto (no cuando es su propio `codigo`).
            codigoBarras =
              esBarcode &&
              existe.codigoBarras == null &&
              existe.codigo !== codigoRaw
                ? codigoRaw
                : undefined;
          }
        } else if (codigoBarrasExplicito) {
          // Producto nuevo con columnas separadas: CÓDIGO = SKU, y el barcode viene
          // en su propia columna. El CÓDIGO se respeta tal cual (no se trata como EAN).
          codigoFinal = codigoRaw;
          codigoBarras = codigoBarrasExplicito;
        } else if (esBarcode) {
          // Legacy: producto nuevo identificado por un EAN puesto en la columna CÓDIGO.
          codigoBarras = codigoRaw;
          codigoFinal = await this.obtenerSiguienteCodigo(empresaId, 'PR');
        } else {
          codigoFinal = codigoRaw;
          codigoBarras = undefined;
        }

        // El STOCK del Excel solo se aplica si la celda trae un número válido;
        // si viene vacía no se toca el stock existente.
        const stockDestino = Number.isNaN(stock) ? undefined : stock;
        // Los productos PADRE (con variantes) tienen stock derivado de sus hijos;
        // no se les debe pisar el stock desde el Excel para evitar doble conteo.
        // OJO: un producto simple puede tener opcionesAtributos = [] (array vacío)
        // guardado por el formulario. Un [] NO es padre: solo lo es cuando trae
        // opciones reales. Antes `!= null` daba true con [] y por eso el stock del
        // Excel no se aplicaba (se quedaba en 0).
        const opcionesExistente: any = existe?.opcionesAtributos;
        const esProductoPadre = Array.isArray(opcionesExistente)
          ? opcionesExistente.length > 0
          : opcionesExistente != null;

        let producto: any;
        let esActualizacion = false;
        if (existe) {
          esActualizacion = true;
          const divisor = 1 + igvPorcentaje / 100;
          const valorUnitario = parseFloat(
            (precioUnitario / divisor).toFixed(2),
          );
          producto = await this.prisma.producto.update({
            where: { id: existe.id },
            data: {
              descripcion: descripcion.toString(),
              unidadMedidaId: Number(unidadMedidaId),
              tipoAfectacionIGV,
              precioUnitario: new Decimal(precioUnitario),
              valorUnitario: new Decimal(valorUnitario),
              igvPorcentaje: new Decimal(igvPorcentaje),
              ...(costoPromedio != null
                ? { costoPromedio: new Decimal(costoPromedio) }
                : {}),
              ...(stockMinimoImport != null && !Number.isNaN(stockMinimoImport)
                ? { stockMinimo: stockMinimoImport }
                : {}),
              ...(categoriaId != null ? { categoriaId } : {}),
              ...(marcaId != null ? { marcaId } : {}),
              ...(codigoBarras != null ? { codigoBarras } : {}),
            },
          });

          // El Excel de una sede asigna el producto a esa sede (catálogo por
          // sede): si ya existía en otra, ahora también está disponible aquí.
          await this.marcarDisponibleEnSede(existe.id, sedeDestinoId);
          if (esProductoPadre) {
            await this.sincronizarDisponibilidadVariantes(existe.id);
          }

          // Reemplazar el stock de la sede destino con el valor del Excel,
          // registrando el ajuste en el Kardex (auditable).
          // Se omite en productos padre: su stock deriva de los hijos.
          if (stockDestino !== undefined && !esProductoPadre) {
            await this.aplicarStockSedeImportacion(
              existe.id,
              empresaId,
              sedeDestinoId,
              stockDestino,
              costoPromedio,
              usuarioId,
            );
          }
        } else {
          producto = await this.crear(
            {
              codigo: codigoFinal,
              descripcion: descripcion.toString(),
              unidadMedidaId: Number(unidadMedidaId),
              tipoAfectacionIGV,
              precioUnitario,
              costoPromedio,
              igvPorcentaje,
              stock: stockDestino ?? 0,
              stockMinimo:
                stockMinimoImport != null && !Number.isNaN(stockMinimoImport)
                  ? stockMinimoImport
                  : undefined,
              categoriaId,
              marcaId,
              codigoBarras,
            },
            empresaId,
            sedeDestinoId,
          );
        }
        resultados.push({ producto, actualizado: esActualizacion });
      } catch (e: any) {
        resultados.push({ error: e?.message || 'Error desconocido' });
      }
    }

    return {
      total: rows.length,
      exitosos: resultados.filter((r) => r.producto).length,
      creados: resultados.filter((r) => r.producto && !r.actualizado).length,
      actualizados: resultados.filter((r) => r.producto && r.actualizado)
        .length,
      fallidos: resultados.filter((r) => r.error).length,
      detalles: resultados,
    };
  }

  /**
   * Reemplaza el stock de un producto en una sede concreta con el valor final
   * indicado (importación de Excel por almacén). Registra el ajuste en el
   * Kardex y mantiene sincronizado el stock global (suma de todas las sedes).
   */
  private async aplicarStockSedeImportacion(
    productoId: number,
    empresaId: number,
    sedeId: number,
    nuevoStock: number,
    costoPromedio?: number,
    usuarioId?: number,
  ) {
    const stockFinal = round3(Math.max(0, num(nuevoStock)));

    const currentStock = await this.prisma.productoStock.findUnique({
      where: { productoId_sedeId: { productoId, sedeId } },
    });
    const stockAnterior = currentStock ? num(currentStock.stock) : 0;

    // Solo registrar movimiento si el stock realmente cambia.
    if (stockAnterior !== stockFinal) {
      const diferencia = round3(stockFinal - stockAnterior);
      const esIngreso = diferencia > 0;
      const cantidad = round3(Math.abs(diferencia));
      try {
        await this.kardexService.registrarMovimiento({
          productoId,
          empresaId,
          sedeId,
          tipoMovimiento: esIngreso ? 'INGRESO' : 'SALIDA',
          concepto: `Importación Excel de inventario (${esIngreso ? '+' : '-'}${cantidad})`,
          cantidad,
          costoUnitario: costoPromedio != null ? Number(costoPromedio) : 0,
          usuarioId,
          observacion: `Stock anterior: ${stockAnterior}, Stock nuevo: ${stockFinal}`,
        });
      } catch (error) {
        console.error(
          'Error al registrar movimiento de kardex desde importación Excel:',
          error,
        );
      }
    }

    // Garantizar el valor final exacto en la sede destino y re-sincronizar
    // el stock global del producto (suma de todas las sedes).
    await this.prisma.productoStock.upsert({
      where: { productoId_sedeId: { productoId, sedeId } },
      update: { stock: stockFinal },
      create: { productoId, sedeId, stock: stockFinal },
    });
    const total = await this.prisma.productoStock.aggregate({
      where: { productoId },
      _sum: { stock: true },
    });
    await this.prisma.producto.update({
      where: { id: productoId },
      data: { stock: round3(num(total._sum.stock)) },
    });
  }

  private getFichaTecnicaComputoDefault(
    params: {
      categoriaNombre?: string | null;
      descripcion?: string | null;
      tipoProducto?: string | null;
    } = {},
  ) {
    return obtenerPlantillaComputo(params);
  }

  private esRubroComputo(nombre?: string | null) {
    return esRubroComputo(nombre);
  }

  async obtenerPlantillaFichaTecnica(
    empresaId: number,
    params: {
      categoriaId?: number;
      descripcion?: string;
      tipoProducto?: string;
    } = {},
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { rubroId: true, rubro: { select: { nombre: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    const categoriaId = Number(params.categoriaId || 0) || undefined;
    const categoria = categoriaId
      ? await this.prisma.categoria.findFirst({
          where: { id: categoriaId, empresaId },
          select: { nombre: true },
        })
      : null;
    const candidates = await this.prisma.fichaTecnicaPlantilla.findMany({
      where: {
        activo: true,
        OR: [
          { empresaId, categoriaId: categoriaId || null },
          { empresaId, categoriaId: null },
          { empresaId: null, categoriaId: categoriaId || null },
          { empresaId: null, rubroId: empresa.rubroId || undefined },
          { empresaId: null, rubroId: null, categoriaId: null },
        ],
      },
      orderBy: [
        { empresaId: 'desc' },
        { categoriaId: 'desc' },
        { rubroId: 'desc' },
        { id: 'asc' },
      ],
      take: 10,
    });

    const exactCategory = candidates.find(
      (item) => categoriaId && item.categoriaId === categoriaId,
    );
    const companyDefault = candidates.find(
      (item) => item.empresaId === empresaId && !item.categoriaId,
    );
    const rubroDefault = candidates.find(
      (item) => item.rubroId === empresa.rubroId,
    );
    const computedDefault = esRubroMotos(empresa.rubro?.nombre)
      ? obtenerPlantillaMotos()
      : this.esRubroComputo(empresa.rubro?.nombre)
        ? this.getFichaTecnicaComputoDefault({
            categoriaNombre: categoria?.nombre,
            descripcion: params.descripcion,
            tipoProducto: params.tipoProducto,
          })
        : null;
    const shouldPreferComputed =
      computedDefault && (computedDefault as any).familia !== 'general';
    const selected =
      exactCategory ||
      companyDefault ||
      (shouldPreferComputed ? computedDefault : rubroDefault) ||
      candidates[0];

    if (selected) return selected;
    if (computedDefault) return computedDefault;
    return null;
  }

  async listarPlantillasFichaTecnica(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { rubroId: true },
    });
    return this.prisma.fichaTecnicaPlantilla.findMany({
      where: {
        OR: [
          { empresaId },
          { empresaId: null, rubroId: empresa?.rubroId || undefined },
          { empresaId: null, rubroId: null },
        ],
      },
      orderBy: [{ empresaId: 'desc' }, { rubroId: 'desc' }, { nombre: 'asc' }],
    });
  }

  async guardarPlantillaFichaTecnica(empresaId: number, dto: any) {
    const campos = Array.isArray(dto?.campos) ? dto.campos : [];
    if (!String(dto?.nombre || '').trim()) {
      throw new BadRequestException('Nombre de plantilla requerido');
    }
    if (campos.length === 0) {
      throw new BadRequestException('Agrega al menos un campo técnico');
    }

    const data = {
      nombre: String(dto.nombre).trim(),
      descripcion: dto.descripcion ? String(dto.descripcion).trim() : null,
      empresaId,
      categoriaId: Number(dto.categoriaId || 0) || null,
      rubroId: null,
      campos,
      destacados: Array.isArray(dto.destacados) ? dto.destacados : [],
      activo: dto.activo !== false,
    };

    if (dto.id) {
      const current = await this.prisma.fichaTecnicaPlantilla.findFirst({
        where: { id: Number(dto.id), empresaId },
      });
      if (!current) throw new NotFoundException('Plantilla no encontrada');
      return this.prisma.fichaTecnicaPlantilla.update({
        where: { id: Number(dto.id) },
        data,
      });
    }

    return this.prisma.fichaTecnicaPlantilla.create({ data });
  }
}
