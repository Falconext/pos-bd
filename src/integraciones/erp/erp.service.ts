import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../s3/s3.service';
import { CODIGOS_FANTASMA, parseImagenesExtra, serializarProducto } from './serializar-producto';
import { keyDeS3, leerTokenImagen, tokenImagen } from './imagen-publica';

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
    private readonly s3: S3Service,
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

  private urlImagen(urlBase: string) {
    return (productoId: number, indice: number) =>
      `${urlBase}/api/v1/erp/images/${tokenImagen(productoId, indice)}`;
  }

  /**
   * El enlace firmado nuevo detrás de una URL estable de foto. Fotos que no
   * están en S3 (una URL externa que pegó el negocio) se devuelven tal cual.
   */
  async urlFirmadaDeImagen(token: string): Promise<string> {
    const t = leerTokenImagen(token);
    const p = t
      ? await this.prisma.producto.findUnique({
          where: { id: t.productoId },
          select: { imagenUrl: true, imagenesExtra: true },
        })
      : null;
    const url = p && t ? [p.imagenUrl, ...parseImagenesExtra(p.imagenesExtra)].filter(Boolean)[t.indice] : null;
    if (!url) throw new NotFoundException({ code: 'image_not_found', message: 'La imagen no existe.' });
    const key = keyDeS3(url);
    return key ? this.s3.getSignedGetUrl(key, 3600) : url;
  }
}
