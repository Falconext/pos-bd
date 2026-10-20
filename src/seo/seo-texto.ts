/**
 * SEO de las tiendas virtuales: la parte que no toca la base ni la red.
 *
 * Hasta octubre de 2026 toda tienda y todo producto respondían con el mismo
 * <title> fijo de la app ("Krezka - Sistema de Facturación"): Google no podía
 * distinguir una tienda de otra y un enlace compartido por WhatsApp mostraba la
 * marca, nunca el producto. Aquí se arman el título, la descripción, la URL
 * canónica, la imagen y los datos estructurados (schema.org) de cada página;
 * el middleware de Vercel (pos-web/middleware.ts) solo los pega en el HTML.
 */

export type Marca = 'krezka' | 'falconext';

export interface TiendaSeo {
  slug: string;
  nombre: string;
  descripcion?: string | null;
  logo?: string | null;
  rubro?: string | null;
  direccion?: string | null;
  distrito?: string | null;
  provincia?: string | null;
  departamento?: string | null;
  whatsapp?: string | null;
  redes?: (string | null | undefined)[];
  marca: Marca;
}

export interface ProductoSeo {
  id: number;
  nombre: string;
  descripcionLarga?: string | null;
  codigo?: string | null;
  precio: number;
  precioOferta?: number | null;
  inicioOferta?: Date | null;
  finOferta?: Date | null;
  moneda?: string | null;
  stock: number;
  /** Servicios y negocios "por encargo" se venden aunque el stock sea 0. */
  vendeSinStock?: boolean;
  imagenes: string[];
  marca?: string | null;
  categoria?: string | null;
  ratingAvg?: number | null;
  ratingCount?: number | null;
}

/** Dominio canónico de cada marca. Una misma tienda responde en los dos. */
export function baseCanonica(marca: Marca): string {
  const env = marca === 'falconext' ? process.env.SEO_BASE_FALCONEXT : process.env.SEO_BASE_KREZKA;
  return (env || (marca === 'falconext' ? 'https://app.falconext.pe' : 'https://app.krezka.com')).replace(/\/$/, '');
}

/** Dominio público de la API de cada marca (sirve las imágenes estables). */
export function baseApi(marca: Marca): string {
  const env = marca === 'falconext' ? process.env.SEO_API_FALCONEXT : process.env.SEO_API_KREZKA;
  return (env || (marca === 'falconext' ? 'https://api.falconext.pe' : 'https://api.krezka.com')).replace(/\/$/, '');
}

export function marcaDeEmpresa(brand?: string | null): Marca {
  return String(brand || '').toLowerCase() === 'falconext' ? 'falconext' : 'krezka';
}

export function marcaDeHost(host?: string | null): Marca {
  return String(host || '').toLowerCase().includes('falconext') ? 'falconext' : 'krezka';
}

/** "Ramo buchón de 50 rosas & más" → "ramo-buchon-de-50-rosas-y-mas". */
export function slugify(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Saca etiquetas HTML, entidades sueltas y espacios repetidos. */
export function limpiarTexto(texto?: string | null): string {
  return String(texto || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MENORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'con', 'para', 'por', 'a', 'al', 'sin']);

/**
 * Muchos negocios escriben todo en MAYÚSCULAS ("RAMO BUCHÓN DE 50 ROSAS"); en
 * un resultado de Google eso se lee como spam. Solo se toca el texto que está
 * casi todo en mayúsculas: lo que ya viene bien escrito queda igual.
 * `frase` para productos ("Ramo buchón de 50 rosas"), `titulo` para nombres
 * de tienda, categoría o marca ("Aceites Esenciales").
 */
export function suavizarMayusculas(texto: string, modo: 'frase' | 'titulo' = 'frase'): string {
  const t = limpiarTexto(texto);
  const letras = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length < 4) return t;
  const mayus = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  if (mayus / letras.length < 0.7) return t;
  const bajo = t.toLowerCase();
  if (modo === 'frase') return bajo.charAt(0).toUpperCase() + bajo.slice(1);
  const originales = t.split(' ');
  return bajo
    .split(' ')
    .map((w, i) => {
      // Siglas societarias y de una letra con punto quedan como estaban: "S.A.C.", "EIRL".
      if (SIGLAS.test(originales[i] ?? '')) return originales[i];
      return i > 0 && MENORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

const SIGLAS = /^(?:[A-Z]\.){1,5}[A-Z]?\.?$|^(?:SAC|SAA|SA|EIRL|SRL|SAS|SL|RUC)\.?,?$/;

/** Recorta en el último espacio antes del límite, sin dejar la palabra a medias. */
export function recortar(texto: string, max: number): string {
  const t = limpiarTexto(texto);
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.–-]+$/, '')}…`;
}

export const urlTienda = (base: string, slug: string) => `${base}/tienda/${encodeURIComponent(slug)}`;

/**
 * URL canónica del producto. El id va primero y en su propio segmento: el
 * router de la tienda ya lo lee así (`/producto/:id`), y el nombre queda como
 * segmento decorativo para Google. Si el nombre cambia, el enlace viejo sigue
 * abriendo y solo cambia el canónico.
 */
export const urlProducto = (base: string, slug: string, p: { id: number; nombre: string }) => {
  const s = slugify(p.nombre);
  return `${urlTienda(base, slug)}/producto/${p.id}${s ? `/${s}` : ''}`;
};

export const urlCatalogo = (base: string, slug: string, categoria?: string | null) =>
  `${urlTienda(base, slug)}/catalogo${categoria ? `?category=${encodeURIComponent(categoria)}` : ''}`;

/**
 * Imagen en una URL que no caduca. Las de S3 se firman por 10 minutos en la
 * tienda (bucket privado), así que no sirven para Google ni para la vista
 * previa de WhatsApp: se sirven por `GET /api/public/img/<clave>`.
 */
export function imagenPublica(url: string | null | undefined, apiBase: string, ancho = 1200): string | null {
  if (!url) return null;
  const idx = url.indexOf('amazonaws.com/');
  if (idx === -1) return /^https?:\/\//i.test(url) ? url : null;
  const clave = url.slice(idx + 'amazonaws.com/'.length).split('?')[0];
  if (!clavePublicable(clave)) return null;
  return `${apiBase}/api/public/img/${clave.split('/').map(encodeURIComponent).join('/')}?w=${ancho}&f=jpg`;
}

/**
 * Solo se sirven imágenes de catálogo y diseño de tienda. Los QR de pago
 * (`tiendas/…/qr/`), PDFs, XML y vouchers no pasan nunca por aquí.
 */
export function clavePublicable(clave: string): boolean {
  if (!clave || clave.includes('..') || clave.startsWith('/')) return false;
  if (/^tiendas\/[^/]+\/(template|media)\//.test(clave)) return true;
  return /^(productos|logos|banners|combos|categorias|marcas)\//.test(clave);
}

export function precioVigente(p: ProductoSeo, ahora = new Date()): { precio: number; enOferta: boolean; hasta?: Date } {
  const oferta = Number(p.precioOferta) || 0;
  const vigente =
    oferta > 0 &&
    oferta < p.precio &&
    (!p.inicioOferta || p.inicioOferta <= ahora) &&
    (!p.finOferta || p.finOferta >= ahora);
  return vigente ? { precio: oferta, enOferta: true, hasta: p.finOferta ?? undefined } : { precio: p.precio, enOferta: false };
}

export function disponibilidad(p: ProductoSeo): string {
  if (Number(p.stock) > 0) return 'https://schema.org/InStock';
  if (p.vendeSinStock) return 'https://schema.org/BackOrder';
  return 'https://schema.org/OutOfStock';
}

const soles = (n: number) => `S/ ${n.toFixed(2)}`;
/** "Autopartes S.A." + "." no debe quedar "S.A..". */
const conPunto = (t: string) => (/[.!?…]$/.test(t) ? t : `${t}.`);
const lugar = (t: TiendaSeo) => [t.distrito, t.provincia].filter(Boolean).map((s) => titulo(String(s))).join(', ');
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export function tituloTienda(t: TiendaSeo): string {
  const rubro = t.rubro ? limpiarTexto(t.rubro) : 'Tienda online';
  return recortar(`${t.nombre} | ${rubro}`, 60);
}

export function descripcionTienda(t: TiendaSeo): string {
  const propia = limpiarTexto(t.descripcion);
  if (propia.length >= 60) return recortar(propia, 160);
  const donde = lugar(t);
  const base = conPunto(`${t.nombre}${t.rubro ? `: ${limpiarTexto(t.rubro).toLowerCase()}` : ''}${donde ? ` en ${donde}` : ''}`);
  return recortar(`${base} ${propia ? `${propia}. ` : ''}Compra online o pide por WhatsApp.`, 160);
}

export function tituloProducto(p: ProductoSeo, t: TiendaSeo): string {
  const sufijo = ` | ${t.nombre}`;
  if (p.nombre.length + sufijo.length <= 60) return `${p.nombre}${sufijo}`;
  // Se recorta el producto, no la tienda: el nombre del negocio es lo que se reconoce.
  const espacio = 60 - sufijo.length;
  return espacio >= 25 ? `${recortar(p.nombre, espacio)}${sufijo}` : recortar(p.nombre, 60);
}

export function descripcionProducto(p: ProductoSeo, t: TiendaSeo, ahora = new Date()): string {
  const propia = limpiarTexto(p.descripcionLarga);
  const { precio, enOferta } = precioVigente(p, ahora);
  const precioTxt = `${enOferta ? 'Oferta: ' : ''}${soles(precio)}`;
  if (propia.length >= 50) return recortar(`${propia} ${precioTxt}.`, 160);
  const donde = lugar(t);
  return recortar(
    `${conPunto(`${p.nombre}${p.categoria ? ` (${limpiarTexto(p.categoria).toLowerCase()})` : ''} a ${precioTxt} en ${t.nombre}${donde ? `, ${donde}` : ''}`)} Compra online o pide por WhatsApp.`,
    160,
  );
}

/** Tipo de negocio de schema.org según el rubro; "Store" si no calza ninguno. */
export function tipoNegocio(rubro?: string | null): string {
  const r = limpiarTexto(rubro).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const reglas: [RegExp, string][] = [
    [/florer|flores/, 'Florist'],
    [/ferreter|construcc/, 'HardwareStore'],
    [/farmac|botica|drogue/, 'Pharmacy'],
    [/ropa|moda|calzado|zapat|textil|boutique/, 'ClothingStore'],
    [/moto|autopart|repuesto|automotri/, 'AutoPartsStore'],
    [/mascota|veterinar/, 'PetStore'],
    [/joyer|bisuter/, 'JewelryStore'],
    [/muebl/, 'FurnitureStore'],
    [/librer|papeler/, 'BookStore'],
    [/electr|comput|celular|tecnolog/, 'ElectronicsStore'],
    [/supermerc|abarrot|bodega|minimarket/, 'GroceryStore'],
    [/juguet/, 'ToyStore'],
    [/restaur|comida|cafeter|pasteler|panader/, 'FoodEstablishment'],
  ];
  return reglas.find(([re]) => re.test(r))?.[1] ?? 'Store';
}

export function jsonLdTienda(t: TiendaSeo, url: string, imagen: string | null): Record<string, unknown> {
  const telefono = String(t.whatsapp || '').replace(/[^\d+]/g, '');
  const sameAs = (t.redes || []).filter((u): u is string => !!u && /^https?:\/\//i.test(u));
  return limpiarVacios({
    '@context': 'https://schema.org',
    '@type': tipoNegocio(t.rubro),
    name: t.nombre,
    url,
    description: descripcionTienda(t),
    image: imagen || undefined,
    logo: imagen || undefined,
    telephone: telefono ? (telefono.startsWith('+') ? telefono : `+51${telefono.replace(/^51(?=9\d{8}$)/, '')}`) : undefined,
    address: t.direccion || t.distrito
      ? limpiarVacios({
          '@type': 'PostalAddress',
          streetAddress: t.direccion ? limpiarTexto(t.direccion) : undefined,
          addressLocality: t.distrito ? titulo(t.distrito) : undefined,
          addressRegion: t.departamento ? titulo(t.departamento) : undefined,
          addressCountry: 'PE',
        })
      : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  });
}

export function jsonLdProducto(p: ProductoSeo, t: TiendaSeo, url: string, ahora = new Date()): Record<string, unknown> {
  const { precio, enOferta, hasta } = precioVigente(p, ahora);
  const descripcion = limpiarTexto(p.descripcionLarga) || descripcionProducto(p, t, ahora);
  return limpiarVacios({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.nombre,
    description: recortar(descripcion, 5000),
    image: p.imagenes.length ? p.imagenes : undefined,
    sku: p.codigo || undefined,
    category: p.categoria ? suavizarMayusculas(p.categoria, 'titulo') : undefined,
    brand: { '@type': 'Brand', name: p.marca || t.nombre },
    offers: limpiarVacios({
      '@type': 'Offer',
      url,
      priceCurrency: (p.moneda || 'PEN').toUpperCase(),
      price: precio.toFixed(2),
      priceValidUntil: enOferta && hasta ? hasta.toISOString().slice(0, 10) : undefined,
      availability: disponibilidad(p),
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: t.nombre },
    }),
    aggregateRating:
      Number(p.ratingCount) > 0 && Number(p.ratingAvg) > 0
        ? { '@type': 'AggregateRating', ratingValue: Number(p.ratingAvg).toFixed(1), reviewCount: Number(p.ratingCount) }
        : undefined,
  });
}

export function jsonLdMigas(items: { nombre: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.nombre, item: it.url })),
  };
}

export const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function xmlUrlset(urls: { loc: string; lastmod?: string; imagen?: string | null }[]): string {
  const filas = urls
    .map(
      (u) =>
        `<url><loc>${escXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${
          u.imagen ? `<image:image><image:loc>${escXml(u.imagen)}</image:loc></image:image>` : ''
        }</url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${filas}\n</urlset>\n`;
}

export function xmlIndice(sitemaps: { loc: string; lastmod?: string }[]): string {
  const filas = sitemaps
    .map((s) => `<sitemap><loc>${escXml(s.loc)}</loc>${s.lastmod ? `<lastmod>${s.lastmod}</lastmod>` : ''}</sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${filas}\n</sitemapindex>\n`;
}

function limpiarVacios<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as T;
}
