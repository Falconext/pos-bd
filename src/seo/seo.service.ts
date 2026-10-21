import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  baseApi,
  baseCanonica,
  descripcionProducto,
  descripcionTienda,
  imagenPublica,
  jsonLdMigas,
  jsonLdProducto,
  jsonLdTienda,
  limpiarTexto,
  marcaDeEmpresa,
  marcaDeHost,
  recortar,
  suavizarMayusculas,
  tituloProducto,
  tituloTienda,
  urlCatalogo,
  urlProducto,
  urlTienda,
  xmlIndice,
  xmlUrlset,
  type ProductoSeo,
  type TiendaSeo,
} from './seo-texto';

export interface PaginaSeo {
  status: 200 | 404;
  tipo: 'tienda' | 'producto' | 'catalogo' | 'seccion' | 'privada' | 'no-encontrada';
  titulo: string;
  descripcion: string;
  canonical: string | null;
  imagen: string | null;
  imagenAlt: string | null;
  robots: string;
  sitio: string | null;
  ogType: 'website' | 'product';
  precio?: string;
  moneda?: string;
  /** Solo en la portada: etiqueta google-site-verification del negocio. */
  verificacionGoogle?: string | null;
  jsonLd: Record<string, unknown>[];
}

const INDEXAR = 'index, follow, max-image-preview:large';
const NO_INDEXAR = 'noindex, nofollow';
const TTL_MS = 5 * 60_000;
const MAX_CACHE = 2000;

/** Igual que TiendaService.whereStockPublico: la tienda no muestra stock negativo. */
const STOCK_PUBLICO = { stock: { gte: 0 } };

const SELECT_EMPRESA = {
  id: true,
  slugTienda: true,
  nombreComercial: true,
  razonSocial: true,
  logo: true,
  descripcionTienda: true,
  whatsappTienda: true,
  facebookUrl: true,
  instagramUrl: true,
  tiktokUrl: true,
  direccion: true,
  distrito: true,
  provincia: true,
  departamento: true,
  tiendaVentaSinStock: true,
  seoTitulo: true,
  seoDescripcion: true,
  seoImagenUrl: true,
  googleVerificacion: true,
  brand: true,
  usaDemo: true,
  estado: true,
  rubro: { select: { nombre: true } },
  plan: { select: { tieneTienda: true, esPrueba: true } },
} as const;

type EmpresaSeo = {
  id: number;
  slugTienda: string | null;
  nombreComercial: string | null;
  razonSocial: string;
  logo: string | null;
  descripcionTienda: string | null;
  whatsappTienda: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  direccion: string | null;
  distrito: string | null;
  provincia: string | null;
  departamento: string | null;
  tiendaVentaSinStock: boolean | null;
  seoTitulo: string | null;
  seoDescripcion: string | null;
  seoImagenUrl: string | null;
  googleVerificacion: string | null;
  brand: string | null;
  usaDemo: boolean | null;
  estado: string;
  rubro: { nombre: string } | null;
  plan: { tieneTienda: boolean; esPrueba: boolean } | null;
};

/**
 * Metadatos SEO de las páginas públicas de la tienda (ver seo-texto.ts).
 *
 * Las reglas de qué producto se ve son las mismas de la tienda pública
 * (TiendaService.obtenerProductoDetalle): un producto que la tienda no muestra
 * nunca se anuncia a Google.
 */
@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);
  private readonly cache = new Map<string, { hasta: number; valor: unknown }>();

  constructor(private readonly prisma: PrismaService) {}

  // ── Página ────────────────────────────────────────────────────────────────

  async pagina(path: string, categoria?: string | null): Promise<PaginaSeo> {
    const ruta = normalizarRuta(path);
    return this.cacheado(`pagina:${ruta}|${categoria ?? ''}`, () => this.resolver(ruta, categoria));
  }

  private async resolver(ruta: string, categoria?: string | null): Promise<PaginaSeo> {
    const m = /^\/tienda\/([^/]+)(\/.*)?$/.exec(ruta);
    if (!m) return noEncontrada();
    const slug = decodeURIComponent(m[1]);
    const resto = m[2] || '';
    if (['login', 'home', 'preview'].includes(slug)) return privada('Tienda');

    const empresa = (await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: SELECT_EMPRESA,
    })) as EmpresaSeo | null;
    // Sin tienda en el plan la API pública responde 403: para Google no existe.
    if (!empresa || !empresa.plan?.tieneTienda) return noEncontrada();

    const tienda = aTiendaSeo(empresa);
    const base = baseCanonica(tienda.marca);
    const api = baseApi(tienda.marca);
    const indexable = esIndexable(empresa);
    const robots = indexable ? INDEXAR : NO_INDEXAR;
    const logo = imagenPublica(empresa.logo, api, 1200);
    // Lo que el negocio escribió en Tienda Virtual → Google manda sobre lo automático.
    const imagenTienda = imagenPublica(empresa.seoImagenUrl, api, 1200) ?? logo;
    const inicio = { nombre: tienda.nombre, url: urlTienda(base, slug) };

    if (resto === '' || resto === '/') {
      return {
        status: 200,
        tipo: 'tienda',
        titulo: propio(empresa.seoTitulo, 60) ?? tituloTienda(tienda),
        descripcion: propio(empresa.seoDescripcion, 160) ?? descripcionTienda(tienda),
        canonical: inicio.url,
        imagen: imagenTienda,
        imagenAlt: tienda.nombre,
        robots,
        sitio: tienda.nombre,
        ogType: 'website',
        verificacionGoogle: limpiarVerificacion(empresa.googleVerificacion),
        jsonLd: [jsonLdTienda(tienda, inicio.url, logo)],
      };
    }

    const prod = /^\/producto\/(\d+)(?:[/-].*)?$/.exec(resto);
    if (prod) {
      const producto = await this.productoPublico(empresa.id, Number(prod[1]));
      if (!producto) return noEncontrada(tienda.nombre);
      const p = aProductoSeo(producto, empresa, api);
      const url = urlProducto(base, slug, p);
      const migas = [inicio];
      if (p.categoria) migas.push({ nombre: suavizarMayusculas(p.categoria, 'titulo'), url: urlCatalogo(base, slug, p.categoria) });
      migas.push({ nombre: p.nombre, url });
      const ld = jsonLdProducto(p, tienda, url);
      const oferta = (ld.offers as Record<string, string>) || {};
      return {
        status: 200,
        tipo: 'producto',
        titulo: propio(producto.seoTitulo, 60) ?? tituloProducto(p, tienda),
        descripcion: propio(producto.seoDescripcion, 160) ?? descripcionProducto(p, tienda),
        canonical: url,
        imagen: p.imagenes[0] ?? logo,
        imagenAlt: p.nombre,
        robots,
        sitio: tienda.nombre,
        ogType: 'product',
        precio: oferta.price,
        moneda: oferta.priceCurrency,
        jsonLd: [ld, jsonLdMigas(migas)],
      };
    }

    if (/^\/catalogo\/?$/.test(resto)) {
      // La URL lleva la categoría tal cual (la tienda filtra por ese texto);
      // el título, suavizado.
      const cat = categoria ? limpiarTexto(categoria) : '';
      const url = urlCatalogo(base, slug, cat || null);
      const catVisible = cat ? suavizarMayusculas(cat, 'titulo') : '';
      const titulo = cat ? `${catVisible} | ${tienda.nombre}` : `Catálogo | ${tienda.nombre}`;
      return {
        status: 200,
        tipo: 'catalogo',
        titulo: recortar(titulo, 60),
        descripcion: recortar(
          cat
            ? `${catVisible} en ${tienda.nombre}. Mira precios y disponibilidad, compra online o pide por WhatsApp.`
            : `Todos los productos de ${tienda.nombre} con precio y stock. Compra online o pide por WhatsApp.`,
          160,
        ),
        canonical: url,
        imagen: logo,
        imagenAlt: tienda.nombre,
        robots,
        sitio: tienda.nombre,
        ogType: 'website',
        jsonLd: [jsonLdMigas([inicio, { nombre: catVisible || 'Catálogo', url }])],
      };
    }

    if (/^\/contacto\/?$/.test(resto)) {
      const url = `${inicio.url}/contacto`;
      return {
        status: 200,
        tipo: 'seccion',
        titulo: recortar(`Contacto | ${tienda.nombre}`, 60),
        descripcion: descripcionTienda(tienda),
        canonical: url,
        imagen: logo,
        imagenAlt: tienda.nombre,
        robots,
        sitio: tienda.nombre,
        ogType: 'website',
        jsonLd: [jsonLdTienda(tienda, inicio.url, logo)],
      };
    }

    // Checkout, seguimiento de pedido, blog y rutas que la SPA resuelve sola:
    // se abren con los datos de la tienda pero no se ofrecen a Google.
    return { ...privada(tienda.nombre), canonical: inicio.url, imagen: logo, imagenAlt: tienda.nombre, descripcion: descripcionTienda(tienda) };
  }

  // ── Sitemaps ──────────────────────────────────────────────────────────────

  /** Índice con un sitemap por tienda indexable de la marca del dominio. */
  async sitemapIndice(host?: string | null): Promise<string> {
    const marca = marcaDeHost(host);
    return this.cacheado(`indice:${marca}`, async () => {
      const empresas = await this.prisma.empresa.findMany({
        where: {
          slugTienda: { not: null },
          estado: 'ACTIVO',
          usaDemo: false,
          plan: { tieneTienda: true, esPrueba: false },
          ...(marca === 'falconext' ? { brand: 'falconext' } : { NOT: { brand: 'falconext' } }),
        },
        select: { slugTienda: true, razonSocial: true },
        orderBy: { id: 'asc' },
      });
      const base = baseCanonica(marca);
      return xmlIndice(
        empresas
          .filter((e) => e.slugTienda && !String(e.razonSocial).toUpperCase().includes('DEMO'))
          .map((e) => ({ loc: `${urlTienda(base, e.slugTienda!)}/sitemap.xml` })),
      );
    });
  }

  async sitemapTienda(slug: string): Promise<string> {
    return this.cacheado(`sitemap:${slug}`, async () => {
      const empresa = (await this.prisma.empresa.findUnique({
        where: { slugTienda: slug },
        select: SELECT_EMPRESA,
      })) as EmpresaSeo | null;
      if (!empresa || !empresa.plan?.tieneTienda || !esIndexable(empresa)) {
        throw new NotFoundException('Tienda sin sitemap');
      }
      const tienda = aTiendaSeo(empresa);
      const base = baseCanonica(tienda.marca);
      const api = baseApi(tienda.marca);
      const productos = await this.productosPublicos(empresa.id);
      const categorias = [...new Set(productos.map((p) => p.categoria?.nombre).filter(Boolean) as string[])].sort();
      return xmlUrlset([
        { loc: urlTienda(base, slug), imagen: imagenPublica(empresa.logo, api) },
        { loc: urlCatalogo(base, slug) },
        ...categorias.map((c) => ({ loc: urlCatalogo(base, slug, c) })),
        ...productos.map((p) => ({
          loc: urlProducto(base, slug, { id: p.id, nombre: p.descripcion }),
          imagen: imagenPublica(p.imagenUrl, api),
        })),
      ]);
    });
  }

  // ── Datos ─────────────────────────────────────────────────────────────────

  private readonly selectProducto = {
    id: true,
    codigo: true,
    descripcion: true,
    descripcionLarga: true,
    precioUnitario: true,
    precioOferta: true,
    fechaInicioOferta: true,
    fechaFinOferta: true,
    moneda: true,
    stock: true,
    imagenUrl: true,
    imagenesExtra: true,
    ratingAvg: true,
    ratingCount: true,
    atributosTecnicos: true,
    seoTitulo: true,
    seoDescripcion: true,
    categoria: { select: { nombre: true } },
    marca: { select: { nombre: true } },
  } as const;

  /** Misma regla que la ficha pública, incluido el respaldo sin publicados. */
  private async productoPublico(empresaId: number, id: number) {
    const publicado = await this.prisma.producto.findFirst({
      where: { id, empresaId, publicarEnTienda: true, estado: 'ACTIVO' },
      select: this.selectProducto,
    });
    if (publicado) return publicado;
    if ((await this.contarPublicados(empresaId)) > 0) return null;
    return this.prisma.producto.findFirst({
      where: { id, empresaId, estado: 'ACTIVO', ...STOCK_PUBLICO },
      select: this.selectProducto,
    });
  }

  /** Lo que lista el catálogo público: publicados, o todo lo activo si no hay ninguno. */
  private async productosPublicos(empresaId: number) {
    const hayPublicados = (await this.contarPublicados(empresaId)) > 0;
    return this.prisma.producto.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        productoPadreId: null,
        ...STOCK_PUBLICO,
        ...(hayPublicados ? { publicarEnTienda: true } : {}),
      },
      select: { id: true, descripcion: true, imagenUrl: true, categoria: { select: { nombre: true } } },
      orderBy: [{ destacado: 'desc' }, { id: 'asc' }],
      take: 45000,
    });
  }

  private contarPublicados(empresaId: number) {
    return this.prisma.producto.count({
      where: { empresaId, publicarEnTienda: true, estado: 'ACTIVO', productoPadreId: null, ...STOCK_PUBLICO },
    });
  }

  private async cacheado<T>(clave: string, calcular: () => Promise<T>): Promise<T> {
    const ahora = Date.now();
    const hit = this.cache.get(clave);
    if (hit && hit.hasta > ahora) return hit.valor as T;
    const valor = await calcular();
    if (this.cache.size >= MAX_CACHE) {
      // Se descarta la entrada más vieja: un Map recorre en orden de inserción.
      const primera = this.cache.keys().next().value;
      if (primera !== undefined) this.cache.delete(primera);
    }
    this.cache.set(clave, { hasta: ahora + TTL_MS, valor });
    return valor;
  }
}

/**
 * Las demos, las cuentas de prueba y las empresas inactivas abren igual, pero
 * no se le ofrecen a Google (mismo criterio que el informe de clientes reales).
 */
function esIndexable(e: EmpresaSeo): boolean {
  return (
    e.estado === 'ACTIVO' &&
    !e.usaDemo &&
    !e.plan?.esPrueba &&
    !String(e.razonSocial || '').toUpperCase().includes('DEMO')
  );
}

function aTiendaSeo(e: EmpresaSeo): TiendaSeo {
  return {
    slug: e.slugTienda!,
    nombre: suavizarMayusculas(e.nombreComercial || e.razonSocial, 'titulo'),
    descripcion: e.descripcionTienda,
    logo: e.logo,
    rubro: e.rubro?.nombre ?? null,
    direccion: e.direccion,
    distrito: e.distrito,
    provincia: e.provincia,
    departamento: e.departamento,
    whatsapp: e.whatsappTienda,
    redes: [e.facebookUrl, e.instagramUrl, e.tiktokUrl],
    marca: marcaDeEmpresa(e.brand),
  };
}

function aProductoSeo(p: any, e: EmpresaSeo, api: string): ProductoSeo {
  const extras = leerImagenesExtra(p.imagenesExtra);
  const imagenes = [p.imagenUrl, ...extras]
    .map((u) => imagenPublica(u, api))
    .filter((u): u is string => !!u)
    .slice(0, 6);
  const tipo = String(p.atributosTecnicos?.tipoProducto || '').toUpperCase();
  return {
    id: p.id,
    nombre: suavizarMayusculas(p.descripcion, 'frase'),
    descripcionLarga: p.descripcionLarga,
    codigo: p.codigo,
    precio: Number(p.precioUnitario) || 0,
    precioOferta: p.precioOferta != null ? Number(p.precioOferta) : null,
    inicioOferta: p.fechaInicioOferta,
    finOferta: p.fechaFinOferta,
    moneda: p.moneda,
    stock: Number(p.stock) || 0,
    vendeSinStock: tipo === 'SERVICIO' || !!e.tiendaVentaSinStock,
    imagenes,
    marca: p.marca?.nombre ? suavizarMayusculas(p.marca.nombre, 'titulo') : null,
    categoria: p.categoria?.nombre ?? null,
    ratingAvg: p.ratingAvg != null ? Number(p.ratingAvg) : null,
    ratingCount: p.ratingCount != null ? Number(p.ratingCount) : null,
  };
}

/** `imagenesExtra` se guarda como texto: JSON de un arreglo o lista separada por comas. */
function leerImagenesExtra(valor: unknown): string[] {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === 'string');
  const s = String(valor).trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/** Texto escrito por el negocio, limpio y dentro del límite; null si está vacío. */
function propio(texto: string | null | undefined, max: number): string | null {
  const t = limpiarTexto(texto);
  return t ? recortar(t, max) : null;
}

/**
 * Search Console da una etiqueta entera
 * (`<meta name="google-site-verification" content="abc123" />`) y la gente la
 * pega tal cual: se guarda solo el código.
 */
export function limpiarVerificacion(valor?: string | null): string | null {
  const v = String(valor || '').trim();
  if (!v) return null;
  const m = /content\s*=\s*["']([^"']+)["']/i.exec(v);
  const codigo = (m ? m[1] : v).trim();
  return /^[A-Za-z0-9_-]{10,100}$/.test(codigo) ? codigo : null;
}

export function normalizarRuta(path: string): string {
  // Las barras dobles van primero: "//tienda" se leería como un dominio.
  let r = String(path || '').split('?')[0].split('#')[0].replace(/\/{2,}/g, '/');
  try {
    r = new URL(r, 'https://x').pathname;
  } catch {
    /* se usa tal cual */
  }
  return r.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

function noEncontrada(sitio: string | null = null): PaginaSeo {
  return {
    status: 404,
    tipo: 'no-encontrada',
    titulo: sitio ? `Página no encontrada | ${sitio}` : 'Tienda no encontrada',
    descripcion: 'La página que buscas no existe o ya no está disponible.',
    canonical: null,
    imagen: null,
    imagenAlt: null,
    robots: NO_INDEXAR,
    sitio,
    ogType: 'website',
    jsonLd: [],
  };
}

function privada(sitio: string): PaginaSeo {
  return {
    status: 200,
    tipo: 'privada',
    titulo: sitio,
    descripcion: '',
    canonical: null,
    imagen: null,
    imagenAlt: null,
    robots: NO_INDEXAR,
    sitio,
    ogType: 'website',
    jsonLd: [],
  };
}
