import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductoService } from '../../producto/producto.service';
import { leerAjuste, leerAlta, leerCambio } from './entrada-producto';
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
  // Todo pasa por ProductoService, el mismo camino del panel: así el valor
  // sin IGV, el código, las sedes y el kardex se calculan igual venga de
  // donde venga el producto. Lo único propio de la API es validar la entrada
  // y verificar que lo que se toca sea de este negocio.

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
        message: `La categoría ${categoriaId} no existe en este negocio. Consulta GET /v1/erp/categories.`,
        param: 'category_id',
      });
    }
  }

  private async verificarSkuLibre(empresaId: number, codigo: string, salvo?: number) {
    const otro = await this.prisma.producto.findFirst({
      where: { empresaId, codigo, ...(salvo ? { id: { not: salvo } } : {}) },
      select: { id: true },
    });
    if (otro) {
      throw new ConflictException({
        code: 'sku_taken',
        message: `Ya hay un producto con el sku ${codigo} (id ${otro.id}).`,
        param: 'sku',
      });
    }
  }

  private async productoPropio(empresaId: number, id: unknown) {
    const productoId = entero(id);
    const p = productoId
      ? await this.prisma.producto.findFirst({
          where: { id: productoId, empresaId, estado: 'ACTIVO' as never, codigo: { notIn: CODIGOS_FANTASMA } },
          select: { id: true, codigo: true, precioUnitario: true },
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
   * hacía saltar avisos de "agotado" falsos (ZABDI, 2026-10-21).
   */
  private async dejarStockEn(
    empresaId: number,
    productoId: number,
    sedeId: number,
    nuevo: number,
    motivo: string,
    nota?: string,
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
  }

  async crearProducto(empresaId: number, body: unknown, urlBase: string) {
    await this.asegurarPlan(empresaId);
    const a = leerAlta(body);
    const sedeId = a.sedeId ? (await this.sedeDe(empresaId, a.sedeId))! : await this.sedePrincipal(empresaId);
    if (a.categoriaId) await this.verificarCategoria(empresaId, a.categoriaId);
    if (a.codigo) await this.verificarSkuLibre(empresaId, a.codigo);
    let unidadMedidaId: number | undefined;
    if (a.unidad) {
      const u = await this.prisma.unidadMedida.findFirst({ where: { codigo: a.unidad }, select: { id: true } });
      if (!u) {
        throw new BadRequestException({
          code: 'parameter_invalid',
          message: `\`unit\` ${a.unidad} no es un código de unidad de SUNAT conocido (ej. NIU, KGM, LTR, ZZ).`,
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
        // El stock inicial va después, como ajuste: así queda en el kardex.
        stock: 0,
        codigo: a.codigo,
        codigoBarras: a.codigoBarras,
        descripcionLarga: a.descripcionLarga,
        categoriaId: a.categoriaId,
        unidadMedidaId,
        precioOferta: a.precioOferta,
        publicarEnTienda: a.publicarEnTienda,
      },
      empresaId,
      sedeId,
    );
    if (a.stock > 0) {
      await this.dejarStockEn(empresaId, creado.id, sedeId, a.stock, 'OTRO', 'Stock inicial');
    }
    return this.obtenerProducto(empresaId, creado.id, undefined, urlBase);
  }

  async actualizarProducto(empresaId: number, id: unknown, body: unknown, urlBase: string) {
    await this.asegurarPlan(empresaId);
    const p = await this.productoPropio(empresaId, id);
    const c = leerCambio(body);
    if (c.categoriaId) await this.verificarCategoria(empresaId, c.categoriaId);
    if (c.codigo && c.codigo !== p.codigo) await this.verificarSkuLibre(empresaId, c.codigo, p.id);
    if (c.precioOferta != null) {
      const precio = c.precioUnitario ?? Number(p.precioUnitario);
      if (c.precioOferta >= precio) {
        throw new BadRequestException({
          code: 'parameter_invalid',
          message: '`sale_price` tiene que ser menor que `price`.',
          param: 'sale_price',
        });
      }
    }
    await this.productos.actualizar({ ...c, id: p.id, empresaId } as any, undefined);
    return this.obtenerProducto(empresaId, p.id, undefined, urlBase);
  }

  async ajustarStock(empresaId: number, id: unknown, body: unknown) {
    await this.asegurarPlan(empresaId);
    const a = leerAjuste(body);
    const productoId = entero(id);
    // Las variantes (talla, color) también tienen su stock: se aceptan.
    const p = productoId
      ? await this.prisma.producto.findFirst({
          where: { id: productoId, empresaId, estado: 'ACTIVO' as never, codigo: { notIn: CODIGOS_FANTASMA } },
          select: { id: true },
        })
      : null;
    if (!p) {
      throw new NotFoundException({ code: 'product_not_found', message: `El producto ${String(id)} no existe en este negocio.` });
    }
    const sedeId = a.sedeId ? (await this.sedeDe(empresaId, a.sedeId))! : await this.sedePrincipal(empresaId);
    const fila = await this.prisma.productoStock.findUnique({
      where: { productoId_sedeId: { productoId: p.id, sedeId } },
      select: { stock: true },
    });
    const antes = Math.round(Number(fila?.stock ?? 0) * 1000) / 1000;
    const despues = Math.round((a.nuevo ?? antes + (a.cambio ?? 0)) * 1000) / 1000;
    if (despues < 0) {
      throw new BadRequestException({
        code: 'insufficient_stock',
        message: `No se puede restar ${Math.abs(a.cambio ?? 0)}: en esa sede hay ${antes}.`,
        param: 'change',
      });
    }
    if (despues !== antes) {
      await this.dejarStockEn(empresaId, p.id, sedeId, despues, a.motivo, a.nota);
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

}
