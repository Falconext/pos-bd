import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductoService } from '../../producto/producto.service';
import { leerAjuste, leerAlta, leerCambio, type Lote } from './entrada-producto';
import { ProductoLoteService } from '../../producto/producto-lote.service';
import { KardexService } from '../../kardex/kardex.service';
import { recalcularStockPadre } from '../../producto/variantes.util';
import { getMaxImagenesProducto, usaLotes } from '../../common/utils/rubro-features';
import { PrismaService } from '../../prisma/prisma.service';
import { CODIGOS_FANTASMA, parseImagenesExtra, serializarProducto } from './serializar-producto';
import { imagenPublica } from '../../seo/seo-texto';

/** El módulo del plan que habilita la API de Krezka. */
export const MODULO_API = 'api';

export interface FiltrosProductos {
  limit?: unknown;
  cursor?: unknown;
  search?: unknown;
  category_id?: unknown;
  location_id?: unknown;
  published?: unknown;
}

const entero = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * La API de Krezka: el catálogo del negocio para su propia web.
 *
 * Todo se filtra por `empresaId`, que sale de la API key y nunca del request:
 * una key solo ve los productos de su negocio.
 */
@Injectable()
export class ErpApiService {
  private readonly planCache = new Map<number, { ok: boolean; hasta: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly productos: ProductoService,
    private readonly lotes: ProductoLoteService,
    private readonly kardex: KardexService,
  ) {}

  /**
   * La key sigue valiendo solo mientras el plan incluya la API. Si el negocio
   * deja de pagarla, su web deja de leer sin que nadie tenga que revocar
   * nada. Se cachea un minuto: la web pide el catálogo seguido.
   */
  async asegurarPlan(empresaId: number): Promise<void> {
    const ahora = Date.now();
    const c = this.planCache.get(empresaId);
    let ok = c && c.hasta > ahora ? c.ok : undefined;
    if (ok === undefined) {
      const e = await this.prisma.empresa.findFirst({
        where: {
          id: empresaId,
          plan: { modulosAsignados: { some: { modulo: { codigo: MODULO_API } } } },
        },
        select: { id: true },
      });
      ok = !!e;
      this.planCache.set(empresaId, { ok, hasta: ahora + 60_000 });
    }
    if (!ok) {
      throw new ForbiddenException({
        code: 'api_not_in_plan',
        message: 'El plan de este negocio no incluye la API de Krezka. Actívala desde tu panel o escríbenos.',
      });
    }
  }

  private readonly incluir = () => ({
    unidadMedida: { select: { codigo: true } },
    categoria: { select: { id: true, nombre: true } },
    marca: { select: { id: true, nombre: true } },
    stocks: {
      select: {
        sedeId: true,
        stock: true,
        visibleEnSede: true,
        vendibleEnSede: true,
        precioUnitarioOverride: true,
        precioOfertaOverride: true,
        sede: { select: { nombre: true } },
      },
    },
    codigosBarras: {
      where: { unidadesPorPaquete: { gt: 1 } },
      select: { codigo: true, unidadesPorPaquete: true, precioPaquete: true, alias: true },
      orderBy: { unidadesPorPaquete: 'asc' as const },
    },
    lotes: {
      where: { activo: true, stockActual: { gt: 0 } },
      select: { lote: true, fechaVencimiento: true, stockActual: true },
      orderBy: { fechaVencimiento: 'asc' as const },
    },
    variantes: {
      where: { estado: 'ACTIVO' as never },
      select: {
        id: true,
        codigo: true,
        codigoBarras: true,
        valoresAtributos: true,
        precioUnitario: true,
        stock: true,
        estado: true,
        stocks: { select: { sedeId: true, stock: true, sede: { select: { nombre: true } } } },
      },
      orderBy: { id: 'asc' as const },
    },
  });

  private async sedeDe(empresaId: number, locationId: unknown): Promise<number | null> {
    const id = entero(locationId);
    if (locationId == null || locationId === '') return null;
    const sede = id
      ? await this.prisma.sede.findFirst({ where: { id, empresaId }, select: { id: true } })
      : null;
    if (!sede) {
      throw new NotFoundException({
        code: 'location_not_found',
        message: `La sede ${String(locationId)} no existe en este negocio. Consulta GET /v1/erp/locations.`,
        param: 'location_id',
      });
    }
    return sede.id;
  }

  async listarProductos(empresaId: number, filtros: FiltrosProductos, urlBase: string) {
    await this.asegurarPlan(empresaId);
    const limite = Math.min(Math.max(entero(filtros.limit) ?? 50, 1), 100);
    const sedeId = await this.sedeDe(empresaId, filtros.location_id);
    const busqueda = String(filtros.search ?? '').trim();
    const categoria = entero(filtros.category_id);
    const soloPublicados = String(filtros.published ?? '').toLowerCase() === 'true';

    const filas = await this.prisma.producto.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO' as never,
        productoPadreId: null,
        codigo: { notIn: CODIGOS_FANTASMA },
        ...(soloPublicados ? { publicarEnTienda: true } : {}),
        ...(categoria ? { categoriaId: categoria } : {}),
        ...(sedeId ? { NOT: { stocks: { some: { sedeId, visibleEnSede: false } } } } : {}),
        ...(busqueda
          ? {
              OR: [
                { descripcion: { contains: busqueda, mode: 'insensitive' as const } },
                { codigo: { contains: busqueda, mode: 'insensitive' as const } },
                { codigoBarras: { equals: busqueda } },
              ],
            }
          : {}),
        ...(entero(filtros.cursor) ? { id: { gt: entero(filtros.cursor)! } } : {}),
      },
      include: this.incluir(),
      orderBy: { id: 'asc' },
      take: limite + 1,
    });
    const hayMas = filas.length > limite;
    const pagina = hayMas ? filas.slice(0, limite) : filas;
    const ctx = { sedeId, urlImagen: this.urlImagen(urlBase) };
    return {
      object: 'list',
      data: pagina.map((p) => serializarProducto(p, ctx)),
      has_more: hayMas,
      next_cursor: hayMas ? String(pagina[pagina.length - 1].id) : null,
    };
  }

  async obtenerProducto(empresaId: number, id: unknown, locationId: unknown, urlBase: string) {
    await this.asegurarPlan(empresaId);
    const sedeId = await this.sedeDe(empresaId, locationId);
    const productoId = entero(id);
    const p = productoId
      ? await this.prisma.producto.findFirst({
          where: { id: productoId, empresaId, estado: 'ACTIVO' as never, codigo: { notIn: CODIGOS_FANTASMA } },
          include: this.incluir(),
        })
      : null;
    if (!p) {
      throw new NotFoundException({
        code: 'product_not_found',
        message: `El producto ${String(id)} no existe en este negocio.`,
      });
    }
    return serializarProducto(p, { sedeId, urlImagen: this.urlImagen(urlBase) });
  }

  async listarSedes(empresaId: number) {
    await this.asegurarPlan(empresaId);
    const sedes = await this.prisma.sede.findMany({
      where: { empresaId, activo: true },
      select: { id: true, nombre: true, direccion: true, esPrincipal: true },
      orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
    });
    return {
      object: 'list',
      data: sedes.map((s) => ({
        object: 'location',
        id: s.id,
        name: s.nombre,
        address: s.direccion ?? null,
        is_main: s.esPrincipal,
      })),
      has_more: false,
      next_cursor: null,
    };
  }

  async listarCategorias(empresaId: number) {
    await this.asegurarPlan(empresaId);
    const cats = await this.prisma.categoria.findMany({
      where: { empresaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    return {
      object: 'list',
      data: cats.map((c) => ({ object: 'category', id: c.id, name: c.nombre })),
      has_more: false,
      next_cursor: null,
    };
  }

  /** Foto en tamaño original: la web decide cómo achicarla (`?w=` acepta 200/400/800/1200). */
  private urlImagen(urlBase: string) {
    return (url: string) => imagenPublica(url, urlBase)?.replace(/\?.*$/, '') ?? null;
  }

  // ── Escritura ─────────────────────────────────────────────────────────
  //
  // Todo pasa por los servicios del panel (ProductoService, el de lotes, el
  // kardex): así el valor sin IGV, el código, las variantes, las sedes y el
  // kardex se calculan igual venga de donde venga el producto. Lo propio de
  // la API es validar la entrada, verificar que lo que se toca sea de este
  // negocio y explicar en cada error qué hacer.

  /** Lo que decide las reglas: el rubro (lotes) y la sede por defecto. */
  private async contextoNegocio(empresaId: number) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { rubro: { select: { nombre: true } } },
    });
    const rubro = e?.rubro?.nombre ?? '';
    // Farmacia, botica, droguería: el lote y el vencimiento son obligatorios
    // (DIGEMID, venta por FEFO). Fabricación los usa para insumos, pero un
    // producto terminado puede no tenerlos: ahí son opcionales, como en el
    // panel. `usaLotes` no reconoce "Droguería … Farmacéutica".
    const loteObligatorio = /farmac|botica|droguer|medicament/i.test(rubro);
    return {
      rubro,
      lotePermitido: loteObligatorio || usaLotes(rubro),
      loteObligatorio,
      maxFotos: getMaxImagenesProducto(rubro),
    };
  }

  private async sedePrincipal(empresaId: number): Promise<number> {
    const s = await this.prisma.sede.findFirst({
      where: { empresaId, activo: true },
      orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!s) throw new BadRequestException({ code: 'no_location', message: 'El negocio no tiene ninguna sede activa.' });
    return s.id;
  }

  private async verificarCategoria(empresaId: number, categoriaId: number) {
    const c = await this.prisma.categoria.findFirst({ where: { id: categoriaId, empresaId }, select: { id: true } });
    if (!c) {
      throw new NotFoundException({
        code: 'category_not_found',
        message: `La categoría ${categoriaId} no existe en este negocio. Consulta GET /v1/erp/categories; las categorías nuevas se crean desde el panel.`,
        param: 'category_id',
      });
    }
  }

  private async verificarMarca(empresaId: number, marcaId: number) {
    const m = await this.prisma.marca.findFirst({ where: { id: marcaId, empresaId }, select: { id: true } });
    if (!m) {
      throw new NotFoundException({
        code: 'brand_not_found',
        message: `La marca ${marcaId} no existe en este negocio. Consulta GET /v1/erp/brands; las marcas nuevas se crean desde el panel.`,
        param: 'brand_id',
      });
    }
  }

  /**
   * Un sku y un código de barras identifican UN producto en el negocio: el POS
   * busca por ellos al escanear. Se revisan los propios, los de las variantes
   * y los de las presentaciones (paquetes).
   */
  private async verificarCodigosLibres(
    empresaId: number,
    codigos: { valor: string; param: string; esSku?: boolean }[],
    salvoProductoId?: number,
  ) {
    const vistos = new Map<string, string>();
    for (const c of codigos) {
      const previo = vistos.get(c.valor.toUpperCase());
      if (previo) {
        throw new ConflictException({ code: 'duplicate_code', message: `\`${c.param}\` repite el código ${c.valor} de \`${previo}\`.`, param: c.param });
      }
      vistos.set(c.valor.toUpperCase(), c.param);
    }
    if (!codigos.length) return;
    const valores = codigos.map((c) => c.valor);
    const salvo = salvoProductoId ? { NOT: { OR: [{ id: salvoProductoId }, { productoPadreId: salvoProductoId }] } } : {};
    const [enProductos, enPaquetes] = await Promise.all([
      this.prisma.producto.findMany({
        where: { empresaId, ...salvo, OR: [{ codigo: { in: valores } }, { codigoBarras: { in: valores } }] },
        select: { id: true, codigo: true, codigoBarras: true },
      }),
      this.prisma.productoCodigoBarras.findMany({
        where: { empresaId, codigo: { in: valores }, ...(salvoProductoId ? { NOT: { productoId: salvoProductoId } } : {}) },
        select: { productoId: true, codigo: true },
      }),
    ]);
    for (const c of codigos) {
      const p = enProductos.find((x) => x.codigo === c.valor || x.codigoBarras === c.valor);
      const q = enPaquetes.find((x) => x.codigo === c.valor);
      const de = p?.id ?? q?.productoId;
      if (de) {
        throw new ConflictException({
          code: c.esSku ? 'sku_taken' : 'barcode_taken',
          message: `El código ${c.valor} ya lo usa el producto ${de}. Cada sku y código de barras tiene que ser único en el negocio.`,
          param: c.param,
        });
      }
    }
  }

  private async productoPropio(empresaId: number, id: unknown) {
    const productoId = entero(id);
    const p = productoId
      ? await this.prisma.producto.findFirst({
          where: { id: productoId, empresaId, estado: 'ACTIVO' as never, codigo: { notIn: CODIGOS_FANTASMA } },
          select: {
            id: true,
            codigo: true,
            precioUnitario: true,
            productoPadreId: true,
            atributosTecnicos: true,
            _count: { select: { variantes: true } },
          },
        })
      : null;
    if (!p) {
      throw new NotFoundException({ code: 'product_not_found', message: `El producto ${String(id)} no existe en este negocio.` });
    }
    return p;
  }

  /**
   * Deja el stock de una sede en `nuevo`, con su movimiento en el kardex.
   *
   * La fila de la sede se asegura ANTES: si no existe, la edición del panel
   * guarda el stock sin movimiento, y un stock sin kardex es justo lo que
   * hacía saltar avisos de "agotado" falsos (ZABDI, 2026-10-21). Si es una
   * variante, el stock del producto padre (la suma) se recalcula.
   */
  private async dejarStockEn(
    empresaId: number,
    productoId: number,
    sedeId: number,
    nuevo: number,
    motivo: string,
    nota?: string,
    padreId?: number | null,
  ) {
    await this.prisma.productoStock.upsert({
      where: { productoId_sedeId: { productoId, sedeId } },
      create: { productoId, sedeId, stock: 0 },
      update: {},
    });
    await this.productos.actualizar(
      {
        id: productoId,
        empresaId,
        sedeId,
        stock: nuevo,
        motivoAjusteStock: motivo,
        detalleAjusteStock: nota ? `${nota} (API)` : 'Desde la API',
      } as any,
      undefined,
    );
    if (padreId) await recalcularStockPadre(this.prisma, padreId);
  }

  /** Entra stock a un lote (lo crea si es nuevo), con su kardex. */
  private async entrarALote(empresaId: number, productoId: number, sedeId: number, cantidad: number, l: Lote, nota?: string) {
    const existente = await this.prisma.productoLote.findFirst({
      where: { productoId, lote: l.numero },
      select: { id: true, activo: true },
    });
    if (!existente) {
      if (!l.vence) {
        throw new BadRequestException({
          code: 'parameter_invalid',
          message: `El lote ${l.numero} es nuevo: manda \`batch.expires_on\` (YYYY-MM-DD).`,
          param: 'batch.expires_on',
        });
      }
      await this.lotes.crearLote({
        productoId,
        empresaId,
        sedeId,
        lote: l.numero,
        fechaVencimiento: l.vence,
        stockInicial: cantidad,
        costoUnitario: l.costo,
      } as any);
      return;
    }
    if (!existente.activo) {
      throw new BadRequestException({ code: 'batch_inactive', message: `El lote ${l.numero} está inactivo.`, param: 'batch.number' });
    }
    const mov = await this.kardex.registrarMovimiento({
      productoId,
      empresaId,
      sedeId,
      tipoMovimiento: 'INGRESO',
      concepto: `Ajuste Lote ${l.numero}${nota ? `: ${nota}` : ''} (API)`,
      cantidad,
    } as any);
    await this.lotes.aumentarStockLote(existente.id, cantidad, mov.id);
  }

  /** Saca stock de un lote concreto, con su kardex. */
  private async salirDeLote(empresaId: number, productoId: number, sedeId: number, cantidad: number, l: Lote, nota?: string) {
    const existente = await this.prisma.productoLote.findFirst({
      where: { productoId, lote: l.numero, activo: true },
      select: { id: true, stockActual: true },
    });
    if (!existente) {
      throw new NotFoundException({ code: 'batch_not_found', message: `El producto no tiene un lote activo ${l.numero}.`, param: 'batch.number' });
    }
    if (Number(existente.stockActual) < cantidad) {
      throw new BadRequestException({
        code: 'insufficient_stock',
        message: `El lote ${l.numero} tiene ${Number(existente.stockActual)}; no se pueden sacar ${cantidad}.`,
        param: 'change',
      });
    }
    const mov = await this.kardex.registrarMovimiento({
      productoId,
      empresaId,
      sedeId,
      tipoMovimiento: 'SALIDA',
      concepto: `Ajuste Lote ${l.numero}${nota ? `: ${nota}` : ''} (API)`,
      cantidad,
    } as any);
    await this.lotes.descontarStockLote(productoId, cantidad, mov.id, existente.id);
  }

  /** Fotos: la primera es la principal; el tope es el del panel. */
  private validarFotos(imagenes: string[] | undefined, maxFotos: number) {
    if (imagenes && imagenes.length > maxFotos) {
      throw new BadRequestException({
        code: 'parameter_invalid',
        message: `Se admiten hasta ${maxFotos} fotos por producto (la primera es la principal).`,
        param: 'images',
      });
    }
  }

  async crearProducto(empresaId: number, body: unknown, urlBase: string) {
    await this.asegurarPlan(empresaId);
    const a = leerAlta(body);
    const ctx = await this.contextoNegocio(empresaId);
    this.validarFotos(a.imagenes, ctx.maxFotos);
    if (a.lote && !ctx.lotePermitido) {
      throw new BadRequestException({
        code: 'batches_not_enabled',
        message: `El rubro de este negocio (${ctx.rubro || 'sin rubro'}) no maneja lotes: manda solo \`stock\`.`,
        param: 'batch',
      });
    }
    if (ctx.loteObligatorio && !a.esServicio && a.stock > 0 && !a.lote) {
      throw new BadRequestException({
        code: 'batch_required',
        message: `Este negocio maneja lotes y vencimientos (${ctx.rubro}): el stock inicial va con \`batch\`: { "number": "L001", "expires_on": "2027-05-31" }. O créalo sin stock y cárgalo después con stock_adjustments.`,
        param: 'batch',
      });
    }
    if (ctx.loteObligatorio && a.variantes?.some((v) => v.stock > 0)) {
      throw new BadRequestException({
        code: 'batch_required',
        message: 'Este negocio maneja lotes: crea las variantes sin stock y carga el de cada una con stock_adjustments y `batch`.',
        param: 'variants',
      });
    }
    const sedeId = a.sedeId ? (await this.sedeDe(empresaId, a.sedeId))! : await this.sedePrincipal(empresaId);
    if (a.categoriaId) await this.verificarCategoria(empresaId, a.categoriaId);
    if (a.marcaId) await this.verificarMarca(empresaId, a.marcaId);
    await this.verificarCodigosLibres(empresaId, [
      ...(a.codigo ? [{ valor: a.codigo, param: 'sku', esSku: true }] : []),
      ...(a.codigoBarras ? [{ valor: a.codigoBarras, param: 'barcode' }] : []),
      ...(a.presentaciones ?? []).map((x, i) => ({ valor: x.codigo, param: `packs[${i}].barcode` })),
      ...(a.variantes ?? []).flatMap((v, i) => [
        ...(v.codigo ? [{ valor: v.codigo, param: `variants[${i}].sku`, esSku: true }] : []),
        ...(v.codigoBarras ? [{ valor: v.codigoBarras, param: `variants[${i}].barcode` }] : []),
      ]),
    ]);
    let unidadMedidaId: number | undefined;
    if (a.unidad) {
      const u = await this.prisma.unidadMedida.findFirst({ where: { codigo: a.unidad }, select: { id: true } });
      if (!u) {
        throw new BadRequestException({
          code: 'parameter_invalid',
          message: `\`unit\` ${a.unidad} no es un código de unidad de SUNAT conocido. Consulta GET /v1/erp/units (ej. NIU unidad, KGM kilo, LTR litro, ZZ servicio).`,
          param: 'unit',
        });
      }
      unidadMedidaId = u.id;
    }

    const creado: any = await this.productos.crear(
      {
        descripcion: a.descripcion,
        precioUnitario: a.precioUnitario,
        tipoAfectacionIGV: a.tipoAfectacionIGV,
        moneda: a.moneda,
        // El stock inicial va después, como ajuste o lote: así queda en el kardex.
        stock: 0,
        codigo: a.codigo,
        codigoBarras: a.codigoBarras,
        descripcionLarga: a.descripcionLarga,
        categoriaId: a.categoriaId,
        marcaId: a.marcaId,
        unidadMedidaId,
        precioOferta: a.precioOferta,
        publicarEnTienda: a.publicarEnTienda,
        imagenUrl: a.imagenes?.[0],
        costoUnitario: a.costo,
        preciosMayorista: a.preciosMayorista,
        codigosBarrasExtra: a.presentaciones,
        ...(a.farmacia ?? {}),
        ...(a.esServicio ? { atributosTecnicos: { tipoProducto: 'SERVICIO' } } : {}),
        ...(a.opcionesVariante
          ? {
              opcionesAtributos: a.opcionesVariante.map((o) => ({ nombre: o.nombre, valores: o.valores })),
              variantesConfig: (a.variantes ?? []).map((v) => ({
                valoresAtributos: v.valores,
                codigo: v.codigo,
                codigoBarras: v.codigoBarras ?? null,
                precioUnitario: v.precio ?? a.precioUnitario,
                stock: 0,
              })),
            }
          : {}),
      } as any,
      empresaId,
      sedeId,
    );
    if (a.imagenes && a.imagenes.length > 1) {
      await this.prisma.producto.update({ where: { id: creado.id }, data: { imagenesExtra: JSON.stringify(a.imagenes.slice(1)) } });
    }
    if (a.lote) {
      await this.entrarALote(empresaId, creado.id, sedeId, a.stock, a.lote, 'Stock inicial');
    } else if (a.stock > 0) {
      await this.dejarStockEn(empresaId, creado.id, sedeId, a.stock, 'OTRO', 'Stock inicial');
    }
    if (a.variantes?.some((v) => v.stock > 0)) {
      const hijas = await this.prisma.producto.findMany({
        where: { productoPadreId: creado.id },
        select: { id: true, valoresAtributos: true },
      });
      for (const v of a.variantes.filter((x) => x.stock > 0)) {
        const clave = JSON.stringify(Object.entries(v.valores).map(([k, x]) => [k.toUpperCase(), x.toUpperCase()]).sort());
        const hija = hijas.find(
          (h) => JSON.stringify(Object.entries((h.valoresAtributos as Record<string, string>) ?? {}).map(([k, x]) => [k.toUpperCase(), String(x).toUpperCase()]).sort()) === clave,
        );
        if (hija) await this.dejarStockEn(empresaId, hija.id, sedeId, v.stock, 'OTRO', 'Stock inicial', creado.id);
      }
    }
    return this.obtenerProducto(empresaId, creado.id, undefined, urlBase);
  }

  async actualizarProducto(empresaId: number, id: unknown, body: unknown, urlBase: string) {
    await this.asegurarPlan(empresaId);
    const p = await this.productoPropio(empresaId, id);
    const c = leerCambio(body);
    const ctx = await this.contextoNegocio(empresaId);
    this.validarFotos(c.imagenes, ctx.maxFotos);
    if (c.categoriaId) await this.verificarCategoria(empresaId, c.categoriaId);
    if (c.marcaId) await this.verificarMarca(empresaId, c.marcaId);
    await this.verificarCodigosLibres(
      empresaId,
      [
        ...(c.codigo && c.codigo !== p.codigo ? [{ valor: c.codigo, param: 'sku', esSku: true }] : []),
        ...(c.codigoBarras ? [{ valor: c.codigoBarras, param: 'barcode' }] : []),
        ...(c.presentaciones ?? []).map((x, i) => ({ valor: x.codigo, param: `packs[${i}].barcode` })),
      ],
      p.id,
    );
    if (c.presentaciones?.length && this.esServicio(p)) {
      throw new BadRequestException({ code: 'parameter_invalid', message: 'Un servicio no tiene presentaciones.', param: 'packs' });
    }
    if (c.precioOferta != null) {
      const precio = c.precioUnitario ?? Number(p.precioUnitario);
      if (c.precioOferta >= precio) {
        throw new BadRequestException({
          code: 'parameter_invalid',
          message: '`sale_price` es el precio de oferta: tiene que ser menor que `price`.',
          param: 'sale_price',
        });
      }
    }
    const { imagenes, presentaciones, farmacia, ...resto } = c;
    await this.productos.actualizar(
      {
        ...resto,
        ...(farmacia ?? {}),
        ...(presentaciones ? { codigosBarrasExtra: presentaciones } : {}),
        id: p.id,
        empresaId,
      } as any,
      undefined,
    );
    // Las fotos se escriben directo: la edición del panel ignora
    // `imagenUrl: null`, y `images: []` no quitaba la principal.
    if (imagenes) {
      await this.prisma.producto.update({
        where: { id: p.id },
        data: { imagenUrl: imagenes[0] ?? null, imagenesExtra: JSON.stringify(imagenes.slice(1)) },
      });
    }
    return this.obtenerProducto(empresaId, p.id, undefined, urlBase);
  }

  private esServicio(p: { atributosTecnicos?: unknown }) {
    return String((p.atributosTecnicos as any)?.tipoProducto ?? '').toUpperCase() === 'SERVICIO';
  }

  async ajustarStock(empresaId: number, id: unknown, body: unknown) {
    await this.asegurarPlan(empresaId);
    const a = leerAjuste(body);
    const p = await this.productoPropio(empresaId, id);
    if (this.esServicio(p)) {
      throw new BadRequestException({ code: 'service_has_no_stock', message: 'Es un servicio: no tiene stock.' });
    }
    if (p._count.variantes > 0) {
      const hijas = await this.prisma.producto.findMany({
        where: { productoPadreId: p.id, estado: 'ACTIVO' as never },
        select: { id: true, valoresAtributos: true },
        take: 5,
      });
      throw new BadRequestException({
        code: 'product_has_variants',
        message: `Este producto tiene variantes: su stock es la suma de ellas. Ajusta cada variante con su propio id (ej. ${hijas
          .map((h) => `${h.id} = ${Object.values((h.valoresAtributos as Record<string, string>) ?? {}).join(' / ')}`)
          .join(', ')}). Los ids están en \`variants\` de GET /v1/erp/products/${p.id}.`,
      });
    }
    const ctx = await this.contextoNegocio(empresaId);
    // Un producto que ya tiene lotes se ajusta siempre por lote, sea cual sea
    // el rubro: si no, el stock de la sede y el de sus lotes se separan.
    const conLotesActivos = (await this.prisma.productoLote.count({ where: { productoId: p.id, activo: true } })) > 0;
    if (a.lote && !ctx.lotePermitido && !conLotesActivos) {
      throw new BadRequestException({
        code: 'batches_not_enabled',
        message: `El rubro de este negocio (${ctx.rubro || 'sin rubro'}) no maneja lotes: ajusta sin \`batch\`.`,
        param: 'batch',
      });
    }
    if ((ctx.loteObligatorio || conLotesActivos) && !a.lote) {
      throw new BadRequestException({
        code: 'batch_required',
        message: `${conLotesActivos ? 'Este producto se maneja por lotes' : `Este negocio maneja lotes y vencimientos (${ctx.rubro})`}: di de qué lote entra o sale con \`batch\`: { "number": "L001", "expires_on": "2027-05-31" } y \`change\`.${conLotesActivos ? ` Los lotes vigentes están en \`batches\` de GET /v1/erp/products/${p.id}.` : ''}`,
        param: 'batch',
      });
    }
    const sedeId = a.sedeId ? (await this.sedeDe(empresaId, a.sedeId))! : await this.sedePrincipal(empresaId);
    const fila = await this.prisma.productoStock.findUnique({
      where: { productoId_sedeId: { productoId: p.id, sedeId } },
      select: { stock: true },
    });
    const antes = Math.round(Number(fila?.stock ?? 0) * 1000) / 1000;

    if (a.lote) {
      const cambio = a.cambio!;
      if (cambio > 0) await this.entrarALote(empresaId, p.id, sedeId, cambio, a.lote, a.nota);
      else await this.salirDeLote(empresaId, p.id, sedeId, -cambio, a.lote, a.nota);
      const despues = await this.prisma.productoStock.findUnique({
        where: { productoId_sedeId: { productoId: p.id, sedeId } },
        select: { stock: true },
      });
      const q = Math.round(Number(despues?.stock ?? 0) * 1000) / 1000;
      return {
        object: 'stock_adjustment',
        product_id: p.id,
        location_id: sedeId,
        batch: a.lote.numero,
        previous_quantity: antes,
        quantity: q,
        change: Math.round((q - antes) * 1000) / 1000,
        reason: a.razon,
      };
    }

    const despues = Math.round((a.nuevo ?? antes + (a.cambio ?? 0)) * 1000) / 1000;
    if (despues < 0) {
      throw new BadRequestException({
        code: 'insufficient_stock',
        message: `No se puede restar ${Math.abs(a.cambio ?? 0)}: en esa sede hay ${antes}.`,
        param: 'change',
      });
    }
    if (despues !== antes) {
      await this.dejarStockEn(empresaId, p.id, sedeId, despues, a.motivo, a.nota, p.productoPadreId);
    }
    return {
      object: 'stock_adjustment',
      product_id: p.id,
      location_id: sedeId,
      previous_quantity: antes,
      quantity: despues,
      change: Math.round((despues - antes) * 1000) / 1000,
      reason: a.razon,
    };
  }

  async listarMarcas(empresaId: number) {
    await this.asegurarPlan(empresaId);
    const marcas = await this.prisma.marca.findMany({
      where: { empresaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    return { object: 'list', data: marcas.map((m) => ({ object: 'brand', id: m.id, name: m.nombre })), has_more: false, next_cursor: null };
  }

  async listarUnidades(empresaId: number) {
    await this.asegurarPlan(empresaId);
    const unidades = await this.prisma.unidadMedida.findMany({ select: { codigo: true, nombre: true }, orderBy: { codigo: 'asc' } });
    return { object: 'list', data: unidades.map((u) => ({ object: 'unit', code: u.codigo, name: u.nombre })), has_more: false, next_cursor: null };
  }

}
