import {
  clavePublicable,
  descripcionProducto,
  descripcionTienda,
  disponibilidad,
  imagenPublica,
  jsonLdProducto,
  jsonLdTienda,
  precioVigente,
  recortar,
  slugify,
  suavizarMayusculas,
  tipoNegocio,
  tituloProducto,
  tituloTienda,
  urlCatalogo,
  urlProducto,
  xmlUrlset,
  type ProductoSeo,
  type TiendaSeo,
} from './seo-texto';
import { normalizarRuta } from './seo.service';

const tienda: TiendaSeo = {
  slug: 'rosas-asociados',
  nombre: 'Rosas & Asociados',
  rubro: 'Florería y Decoración',
  distrito: 'SAN BORJA',
  provincia: 'LIMA',
  departamento: 'LIMA',
  direccion: 'Av. Primavera 543',
  whatsapp: '987 654 321',
  redes: ['https://instagram.com/rosas', null, 'no-es-url'],
  marca: 'krezka',
};

const producto = (p: Partial<ProductoSeo> = {}): ProductoSeo => ({
  id: 34847,
  nombre: 'Ramo buchón de 50 rosas',
  precio: 320,
  stock: 3,
  imagenes: ['https://api.krezka.com/api/public/img/productos/x.webp?w=1200&f=jpg'],
  categoria: 'Ramos y arreglos',
  ...p,
});

describe('textos', () => {
  it('slug legible sin tildes, eñes ni símbolos', () => {
    expect(slugify('Ramo buchón de 50 rosas & más ñandú!')).toBe('ramo-buchon-de-50-rosas-y-mas-nandu');
    expect(slugify('  ')).toBe('');
  });

  it('recorta en una palabra completa y marca el corte', () => {
    expect(recortar('uno dos tres cuatro cinco seis', 15)).toBe('uno dos tres…');
    expect(recortar('<p>hola&nbsp;  mundo</p>', 50)).toBe('hola mundo');
  });

  it('título de producto: "Producto | Tienda" en máximo 60 caracteres', () => {
    expect(tituloProducto(producto(), tienda)).toBe('Ramo buchón de 50 rosas | Rosas & Asociados');
    const largo = tituloProducto(producto({ nombre: 'Arreglo floral premium de rosas rojas importadas con base de cerámica artesanal' }), tienda);
    expect(largo.length).toBeLessThanOrEqual(60);
    expect(largo.endsWith('| Rosas & Asociados')).toBe(true);
  });

  it('título y descripción de la tienda sin descripción propia usan rubro y distrito', () => {
    expect(tituloTienda(tienda)).toBe('Rosas & Asociados | Florería y Decoración');
    const d = descripcionTienda(tienda);
    expect(d).toContain('florería y decoración en San Borja, Lima');
    expect(d.length).toBeLessThanOrEqual(160);
  });

  it('descripción de producto con precio; usa la descripción larga si es buena', () => {
    expect(descripcionProducto(producto(), tienda)).toBe(
      'Ramo buchón de 50 rosas (ramos y arreglos) a S/ 320.00 en Rosas & Asociados, San Borja, Lima. Compra online o pide por WhatsApp.',
    );
    const propia = descripcionProducto(producto({ descripcionLarga: '<p>Cincuenta rosas rojas premium envueltas en papel coreano.</p>' }), tienda);
    expect(propia).toBe('Cincuenta rosas rojas premium envueltas en papel coreano. S/ 320.00.');
  });
});

describe('mayúsculas', () => {
  it('solo suaviza lo que viene casi todo en MAYÚSCULAS', () => {
    expect(suavizarMayusculas('RAMO BUCHÓN DE 50 ROSAS')).toBe('Ramo buchón de 50 rosas');
    expect(suavizarMayusculas('ACEITES ESENCIALES', 'titulo')).toBe('Aceites Esenciales');
    expect(suavizarMayusculas('INVERSIONES SUMAQ DE LA SIERRA', 'titulo')).toBe('Inversiones Sumaq de la Sierra');
    expect(suavizarMayusculas('Ramo de iPhone XR')).toBe('Ramo de iPhone XR');
    expect(suavizarMayusculas('aceite esencial - ARTESANAL')).toBe('aceite esencial - ARTESANAL');
    expect(suavizarMayusculas('LED')).toBe('LED');
  });
});

describe('precio y stock', () => {
  const ahora = new Date('2026-10-20T12:00:00Z');
  it('la oferta vale solo dentro de sus fechas y si es menor', () => {
    const p = producto({ precioOferta: 290, inicioOferta: new Date('2026-10-01'), finOferta: new Date('2026-10-31') });
    expect(precioVigente(p, ahora)).toMatchObject({ precio: 290, enOferta: true });
    expect(precioVigente({ ...p, finOferta: new Date('2026-10-10') }, ahora).precio).toBe(320);
    expect(precioVigente({ ...p, precioOferta: 400 }, ahora).precio).toBe(320);
  });

  it('disponibilidad', () => {
    expect(disponibilidad(producto())).toBe('https://schema.org/InStock');
    expect(disponibilidad(producto({ stock: 0 }))).toBe('https://schema.org/OutOfStock');
    expect(disponibilidad(producto({ stock: 0, vendeSinStock: true }))).toBe('https://schema.org/BackOrder');
  });
});

describe('URLs', () => {
  const base = 'https://app.krezka.com';
  it('producto: id en su segmento y nombre legible después', () => {
    expect(urlProducto(base, 'rosas-asociados', producto())).toBe(
      'https://app.krezka.com/tienda/rosas-asociados/producto/34847/ramo-buchon-de-50-rosas',
    );
  });
  it('catálogo con categoría usa el mismo parámetro que la tienda (?category=)', () => {
    expect(urlCatalogo(base, 's', 'Ramos y arreglos')).toBe('https://app.krezka.com/tienda/s/catalogo?category=Ramos%20y%20arreglos');
  });
  it('ruta normalizada', () => {
    expect(normalizarRuta('/tienda/a/producto/1/?x=1#y')).toBe('/tienda/a/producto/1');
    expect(normalizarRuta('//tienda//a/')).toBe('/tienda/a');
  });
});

describe('imágenes', () => {
  const api = 'https://api.krezka.com';
  it('S3 pasa a la URL estable; otras URL quedan igual', () => {
    expect(imagenPublica('https://nexara-s3.s3.us-east-1.amazonaws.com/productos/empresa-98/producto-1/principal-1.webp', api)).toBe(
      'https://api.krezka.com/api/public/img/productos/empresa-98/producto-1/principal-1.webp?w=1200&f=jpg',
    );
    expect(imagenPublica('https://otro.com/a.jpg', api)).toBe('https://otro.com/a.jpg');
    expect(imagenPublica(null, api)).toBeNull();
  });
  it('nunca expone QR de pago, comprobantes ni rutas raras', () => {
    expect(clavePublicable('productos/empresa-1/x.webp')).toBe(true);
    expect(clavePublicable('tiendas/empresa-1/template/hero-1.webp')).toBe(true);
    expect(clavePublicable('tiendas/empresa-1/qr/yape-1.webp')).toBe(false);
    expect(clavePublicable('comprobantes/empresa-1/B001-1.pdf')).toBe(false);
    expect(clavePublicable('productos/../comprobantes/x.pdf')).toBe(false);
    expect(imagenPublica('https://b.s3.amazonaws.com/tiendas/empresa-1/qr/yape.webp', api)).toBeNull();
  });
});

describe('datos estructurados', () => {
  it('Product con Offer en soles y disponibilidad', () => {
    const ld = jsonLdProducto(producto({ codigo: 'RAM-050', ratingAvg: 4.8, ratingCount: 12 }), tienda, 'https://u');
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Ramo buchón de 50 rosas',
      sku: 'RAM-050',
      brand: { name: 'Rosas & Asociados' },
      offers: { price: '320.00', priceCurrency: 'PEN', availability: 'https://schema.org/InStock', url: 'https://u' },
      aggregateRating: { ratingValue: '4.8', reviewCount: 12 },
    });
  });
  it('sin reseñas no inventa estrellas', () => {
    expect(jsonLdProducto(producto(), tienda, 'u')).not.toHaveProperty('aggregateRating');
  });
  it('la tienda se declara según su rubro, con dirección y teléfono internacional', () => {
    const ld = jsonLdTienda(tienda, 'https://u', null);
    expect(ld['@type']).toBe('Florist');
    expect(ld.telephone).toBe('+51987654321');
    expect(ld.address).toMatchObject({ addressLocality: 'San Borja', addressCountry: 'PE' });
    expect(ld.sameAs).toEqual(['https://instagram.com/rosas']);
  });
  it('tipos por rubro', () => {
    expect(tipoNegocio('Ferretería')).toBe('HardwareStore');
    expect(tipoNegocio('Botica y farmacia')).toBe('Pharmacy');
    expect(tipoNegocio('Venta de artículos varios')).toBe('Store');
  });
});

describe('sitemap', () => {
  it('escapa & y agrega la imagen', () => {
    const xml = xmlUrlset([{ loc: 'https://a/tienda/x/catalogo?category=A&B', imagen: 'https://i/1.jpg' }]);
    expect(xml).toContain('<loc>https://a/tienda/x/catalogo?category=A&amp;B</loc>');
    expect(xml).toContain('<image:loc>https://i/1.jpg</image:loc>');
  });
});
