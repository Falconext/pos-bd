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
  esRubroComputo,
  obtenerPlantillaComputo,
} from './ficha-tecnica-computo';
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
      throw new ForbiddenException('Ya existe un producto con ese código');
    }

    // 2. Validar unicidad de Código de Barras (si se proporciona)
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

      // Inicializar el registro de stock por sede. Solo la sede que crea el producto
      // (o la principal si no se conoce la sede) recibe el stock inicial. Las demás
      // arrancan en 0 para que los traslados partan de valores reales y no inflados.
      const sedes = await this.prisma.sede.findMany({
        where: { empresaId, activo: true },
      });
      if (sedes.length > 0) {
        const sedePrincipalId = sedes.find((s) => s.esPrincipal)?.id;
        // La sede que recibe el stock inicial: la del usuario actual, o la principal como fallback.
        const sedeConStock = sedeId ?? sedePrincipalId;
        await this.prisma.productoStock.createMany({
          data: sedes.map((s) => ({
            productoId: nuevo.id,
            sedeId: s.id,
            stock: !esServicio && s.id === sedeConStock ? (stock ?? 0) : 0,
            stockMinimo: stockMinimo ?? 0,
            stockMaximo: stockMaximo ?? null,
            visibleEnSede:
              s.id === sedeConStock ? (visibleEnSede ?? true) : true,
            vendibleEnSede:
              s.id === sedeConStock ? (vendibleEnSede ?? true) : true,
            precioUnitarioOverride:
              s.id === sedeConStock && precioUnitarioSede != null
                ? new Decimal(precioUnitarioSede)
                : null,
            precioOfertaOverride:
              s.id === sedeConStock && precioOfertaSede != null
                ? new Decimal(precioOfertaSede)
                : null,
            ubicacion: s.id === sedeConStock ? ubicacionSede || null : null,
          })),
        });
      }
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
    }

    return this.obtenerPorId(nuevo.id, empresaId);
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
      OR: searchTerm
        ? [
            { descripcion: { contains: searchTerm, mode: 'insensitive' } },
            { codigo: { contains: searchTerm, mode: 'insensitive' } },
            { principioActivo: { contains: searchTerm, mode: 'insensitive' } },
            { codigoBarras: { contains: searchTerm, mode: 'insensitive' } },
            { codigoDigemid: { contains: searchTerm, mode: 'insensitive' } },
            { laboratorio: { contains: searchTerm, mode: 'insensitive' } },
          ]
        : undefined,
    };

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
    }

    const [productosRaw, total] = await Promise.all([
      this.prisma.producto.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: { [sort]: order },
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
        const precioUnitarioEfectivo =
          params.usarPrecioSede && stockSede?.precioUnitarioOverride != null
            ? Number(stockSede.precioUnitarioOverride)
            : Number(p.precioUnitario);
        const precioOfertaEfectivo =
          params.usarPrecioSede && stockSede?.precioOfertaOverride != null
            ? Number(stockSede.precioOfertaOverride)
            : p.precioOferta != null
              ? Number(p.precioOferta)
              : null;
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
            const variantePrecioUnitario =
              params.usarPrecioSede &&
              varianteStockSede?.precioUnitarioOverride != null
                ? Number(varianteStockSede.precioUnitarioOverride)
                : Number(variante.precioUnitario);
            const variantePrecioOferta =
              params.usarPrecioSede &&
              varianteStockSede?.precioOfertaOverride != null
                ? Number(varianteStockSede.precioOfertaOverride)
                : variante.precioOferta != null
                  ? Number(variante.precioOferta)
                  : null;

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
        };
      }),
    );

    return { productos, total, page, limit };
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
      ...(searchTerm
        ? {
            OR: [
              { descripcion: { contains: searchTerm, mode: 'insensitive' } },
              { codigo: { contains: searchTerm, mode: 'insensitive' } },
              {
                principioActivo: { contains: searchTerm, mode: 'insensitive' },
              },
              { codigoBarras: { contains: searchTerm, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

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
      const precioUnitario =
        stockSede?.precioUnitarioOverride != null
          ? Number(stockSede.precioUnitarioOverride)
          : Number(p.precioUnitario);
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
            precioUnitario: true,
            moneda: true,
            precioOferta: true,
            stock: true,
            estado: true,
            valoresAtributos: true,
            imagenUrl: true,
          },
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
    };
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

    // 1. Intentar buscar en el catálogo local de la empresa
    const producto = await this.prisma.producto.findFirst({
      where: {
        empresaId,
        codigoBarras,
        estado: { not: 'PLACEHOLDER' as any },
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
        imagenUrl: true,
        tipoAfectacionIGV: true,
        unidadMedida: true,
        categoria: true,
        marca: true,
      },
    });

    if (producto) {
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
        loteFefoCodigo: loteFefoActual?.lote || null,
        loteFefoVencimiento: loteFefoActual?.fechaVencimiento || null,
        loteFefoCostoUnitario: loteFefoActual?.costoUnitario
          ? Number(loteFefoActual.costoUnitario)
          : null,
        isGlobal: false,
        costoUnitario: Number((producto as any).costoPromedio) || 0,
      };
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

    // Validar unicidad de Código de Barras (si cambió)
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
    }

    return this.obtenerPorId(actualizado.id, data.empresaId);
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

  async exportar(empresaId: number, search?: string): Promise<Buffer> {
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
    };

    const productos = await this.prisma.producto.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { unidadMedida: true, categoria: true, marca: true },
    });

    const datosExcel = productos.map((producto) => ({
      CÓDIGO: (producto as any)?.codigoBarras || producto.codigo,
      PRODUCTO: producto.descripcion,
      'U.M': producto.unidadMedida?.nombre || '',
      AFECT: producto.tipoAfectacionIGV,
      'PRECIO UNITARIO': Number(producto.precioUnitario),
      IGV: Number(producto.igvPorcentaje),
      STOCK: Number(producto.stock),
      CATEGORIA: producto.categoria?.nombre || '',
      MARCA: (producto as any)?.marca?.nombre || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 100 },
      { wch: 20 },
      { wch: 10 },
      { wch: 15 },
      { wch: 8 },
      { wch: 10 },
      { wch: 20 },
      { wch: 20 },
    ];

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    return buffer;
  }

  async plantilla(): Promise<Buffer> {
    const filas = [
      {
        CÓDIGO: 'PR001',
        PRODUCTO: 'Producto sin código de barras (SKU manual)',
        'U.M': 'UNIDAD',
        AFECT: '10',
        'PRECIO UNITARIO': 10.0,
        IGV: 18,
        STOCK: 100,
        CATEGORIA: 'General',
        MARCA: '',
      },
      {
        CÓDIGO: '7750243072366',
        PRODUCTO: 'Producto con código de barras EAN-13',
        'U.M': 'UNIDAD',
        AFECT: '10',
        'PRECIO UNITARIO': 25.5,
        IGV: 18,
        STOCK: 50,
        CATEGORIA: 'Abarrotes',
        MARCA: 'Ejemplo',
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet(filas);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 50 },
      { wch: 12 },
      { wch: 8 },
      { wch: 16 },
      { wch: 6 },
      { wch: 8 },
      { wch: 20 },
      { wch: 20 },
    ];
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
      ETIQ: 'NIU',
      PZA: 'NIU',
      PZ: 'NIU',
      LT: 'LTR',
      LTS: 'LTR',
      LITRO: 'LTR',
      MT: 'MTR',
      MTS: 'MTR',
      METRO: 'MTR',
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

  async cargaMasiva(fileBuffer: Buffer, empresaId: number) {
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
          row['PRECIO UNITARIO'] ??
          row['Precio Unitario'] ??
          row['precioUnitario'] ??
          null;
        const precioCostoRaw =
          row['PRECIO COSTO'] ?? row['Precio Costo'] ?? null;
        const igvRaw = row['IGV'] ?? row['igv'] ?? null;
        const stockRaw = row['STOCK'] ?? row['Stock'] ?? row['stock'] ?? null;
        const categoriaRaw =
          row['CATEGORIA'] ?? row['Categoría'] ?? row['categoria'] ?? null;
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

        // Si CÓDIGO es solo dígitos de 8-14 chars → es un código de barras EAN/UPC
        const codigoRaw = codigo.toString().trim();
        const esBarcode = /^\d{8,14}$/.test(codigoRaw);
        let codigoFinal: string;
        let codigoBarras: string | undefined;
        if (esBarcode) {
          codigoBarras = codigoRaw;
          codigoFinal = await this.obtenerSiguienteCodigo(empresaId, 'PR');
        } else {
          codigoFinal = codigoRaw;
          codigoBarras = undefined;
        }

        const unidadKey = unidadNombre
          .toString()
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const unidadMedidaId = unidadMap.get(unidadKey);
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
        const costoPromedio =
          precioCostoRaw != null
            ? parseFloat(precioCostoRaw.toString())
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

        // Upsert: si es barcode busca por codigoBarras, si es SKU busca por codigo
        const existe = await this.prisma.producto.findFirst({
          where: esBarcode
            ? { empresaId, codigoBarras, estado: { not: 'PLACEHOLDER' as any } }
            : {
                empresaId,
                codigo: codigoFinal,
                estado: { not: 'PLACEHOLDER' as any },
              },
          select: { id: true },
        });

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
              ...(categoriaId != null ? { categoriaId } : {}),
              ...(codigoBarras != null ? { codigoBarras } : {}),
            },
          });
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
              stock,
              categoriaId,
              codigoBarras,
            },
            empresaId,
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
    const computedDefault = this.esRubroComputo(empresa.rubro?.nombre)
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
