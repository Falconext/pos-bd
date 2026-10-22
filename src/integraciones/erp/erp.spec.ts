/**
 * La API de Krezka para el propio negocio (2026-10-22): varios clientes
 * pidieron mostrar sus productos en su página web, con precio y stock al día,
 * leyéndolos de Krezka.
 */
import { keyDeS3, leerTokenImagen, tokenImagen } from './imagen-publica';
import { precioDeOferta, serializarProducto, stockDe } from './serializar-producto';
import { ErpApiService } from './erp.service';
import { urlBaseDe } from './erp.controller';

const URL_IMG = (id: number, i: number) => `https://api.krezka.com/api/v1/erp/images/${id}-${i}`;

const PRODUCTO = {
  id: 501,
  codigo: 'MOR-90',
  codigoBarras: '7751234567890',
  descripcion: 'Moringa 90 cápsulas',
  descripcionLarga: 'Suplemento natural',
  precioUnitario: '31.00',
  moneda: 'PEN',
  tipoAfectacionIGV: '10',
  stock: '0',
  costoPromedio: '12.40',
  comisionPorVenta: '2',
  publicarEnTienda: true,
  destacado: false,
  disponibilidad: null,
  imagenUrl: 'https://nexara-s3.s3.us-east-1.amazonaws.com/productos/empresa-89/p501.webp',
  imagenesExtra: '["https://nexara-s3.s3.us-east-1.amazonaws.com/productos/empresa-89/extra-1.webp"]',
  unidadMedida: { codigo: 'NIU' },
  categoria: { id: 7, nombre: 'Suplementos' },
  marca: null,
  stocks: [
    { sedeId: 1, stock: '12', sede: { nombre: 'Principal' } },
    { sedeId: 2, stock: '3', sede: { nombre: 'Miraflores' }, precioUnitarioOverride: '33' },
  ],
  variantes: [],
  creadoEn: new Date('2026-10-01T15:00:00Z'),
};

describe('el producto que ve la web', () => {
  it('trae lo que muestra una tienda y nunca costos ni comisiones', () => {
    const p = serializarProducto(PRODUCTO, { urlImagen: URL_IMG });
    expect(p).toMatchObject({
      id: 501,
      sku: 'MOR-90',
      name: 'Moringa 90 cápsulas',
      price: 31,
      sale_price: null,
      currency: 'PEN',
      tax_included: true,
      category: { id: 7, name: 'Suplementos' },
      stock: 15,
      availability: 'in_stock',
      images: [URL_IMG(501, 0), URL_IMG(501, 1)],
    });
    expect(p.stock_by_location).toEqual([
      { location_id: 1, location: 'Principal', quantity: 12 },
      { location_id: 2, location: 'Miraflores', quantity: 3 },
    ]);
    const texto = JSON.stringify(p);
    expect(texto).not.toMatch(/costo|comision|12\.4/i);
  });

  it('con una sede: su stock y su precio propio', () => {
    const p = serializarProducto(PRODUCTO, { urlImagen: URL_IMG, sedeId: 2 });
    expect(p.stock).toBe(3);
    expect(p.price).toBe(33);
  });

  it('sin stock por sede usa el general; sin stock está agotado', () => {
    expect(stockDe({ stock: '4', stocks: [] }).total).toBe(4);
    const agotado = serializarProducto({ ...PRODUCTO, stocks: [], stock: 0 }, { urlImagen: URL_IMG });
    expect(agotado.availability).toBe('out_of_stock');
    const bajoPedido = serializarProducto({ ...PRODUCTO, stocks: [], stock: 0, disponibilidad: 'BAJO_PEDIDO' }, { urlImagen: URL_IMG });
    expect(bajoPedido.availability).toBe('backorder');
  });

  it('la oferta vale solo activa y dentro de sus fechas', () => {
    const ahora = new Date('2026-10-22T12:00:00Z');
    expect(precioDeOferta({ ofertaActiva: true, precioOferta: 25 }, ahora)).toBe(25);
    expect(precioDeOferta({ ofertaActiva: false, precioOferta: 25 }, ahora)).toBeNull();
    expect(precioDeOferta({ ofertaActiva: true, precioOferta: 25, fechaFinOferta: new Date('2026-10-21') }, ahora)).toBeNull();
    expect(precioDeOferta({ ofertaActiva: true, precioOferta: 25, fechaInicioOferta: new Date('2026-10-30') }, ahora)).toBeNull();
  });

  it('las variantes (tallas, colores) van dentro de su producto, sin las inactivas', () => {
    const p = serializarProducto(
      {
        ...PRODUCTO,
        variantes: [
          { id: 601, codigo: 'POLO-M', valoresAtributos: { talla: 'M' }, precioUnitario: 0, estado: 'ACTIVO', stocks: [{ sedeId: 1, stock: 4 }] },
          { id: 602, codigo: 'POLO-L', valoresAtributos: { talla: 'L' }, precioUnitario: 35, estado: 'INACTIVO', stocks: [] },
        ],
      },
      { urlImagen: URL_IMG },
    );
    expect(p.variants).toEqual([
      expect.objectContaining({ id: 601, sku: 'POLO-M', attributes: { talla: 'M' }, price: 31, stock: 4 }),
    ]);
  });
});

describe('la dirección fija de las fotos', () => {
  const previo = process.env.JWT_SECRET;
  beforeAll(() => (process.env.JWT_SECRET = 'secreto-de-prueba'));
  afterAll(() => (process.env.JWT_SECRET = previo));

  it('el token lleva el producto y la foto, firmados', () => {
    expect(leerTokenImagen(tokenImagen(501, 1))).toEqual({ productoId: 501, indice: 1 });
  });

  it('no se puede pedir la foto de otro producto cambiando el número', () => {
    const [, i, f] = tokenImagen(501, 0).split('.');
    expect(leerTokenImagen(`${(502).toString(36)}.${i}.${f}`)).toBeNull();
    expect(leerTokenImagen('basura')).toBeNull();
  });

  it('saca la key de S3 de la URL guardada', () => {
    expect(keyDeS3(PRODUCTO.imagenUrl)).toBe('productos/empresa-89/p501.webp');
    expect(keyDeS3('https://otra-web.com/foto.jpg')).toBeNull();
  });
});

describe('el servicio', () => {
  function armar(opts: { conPlan?: boolean; productos?: any[] } = {}) {
    const prisma: any = {
      empresa: { findFirst: jest.fn(async () => (opts.conPlan === false ? null : { id: 89 })) },
      sede: { findFirst: jest.fn(async ({ where }: any) => (where.id === 2 ? { id: 2 } : null)) },
      producto: {
        findMany: jest.fn(async () => opts.productos ?? [PRODUCTO, { ...PRODUCTO, id: 502 }, { ...PRODUCTO, id: 503 }]),
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => PRODUCTO),
      },
    };
    const s3: any = { getSignedGetUrl: jest.fn(async (k: string) => `https://firmada/${k}?x=1`) };
    return { s: new ErpApiService(prisma, s3), prisma, s3 };
  }

  it('solo productos de este negocio, activos, sin los internos, paginando por id', async () => {
    const { s, prisma } = armar();
    const r = await s.listarProductos(89, { limit: 2, search: 'moringa' }, 'https://api.krezka.com');
    const where = prisma.producto.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ empresaId: 89, estado: 'ACTIVO', productoPadreId: null, codigo: { notIn: ['DGD', 'IPM', 'PLD'] } });
    expect(where.OR[0]).toEqual({ descripcion: { contains: 'moringa', mode: 'insensitive' } });
    expect(prisma.producto.findMany.mock.calls[0][0].take).toBe(3);
    expect(r).toMatchObject({ object: 'list', has_more: true, next_cursor: '502' });
    expect(r.data).toHaveLength(2);
  });

  it('sin la API en el plan, la key deja de leer', async () => {
    const { s } = armar({ conPlan: false });
    await expect(s.listarProductos(89, {}, 'x')).rejects.toMatchObject({
      response: { code: 'api_not_in_plan' },
    });
  });

  it('una sede de otro negocio es "no existe", no un catálogo vacío', async () => {
    const { s } = armar();
    await expect(s.listarProductos(89, { location_id: 99 }, 'x')).rejects.toMatchObject({
      response: { code: 'location_not_found', param: 'location_id' },
    });
  });

  it('un producto ajeno o inexistente es 404', async () => {
    const { s } = armar();
    await expect(s.obtenerProducto(89, 999, undefined, 'x')).rejects.toMatchObject({
      response: { code: 'product_not_found' },
    });
  });

  it('la foto redirige a un enlace firmado nuevo', async () => {
    const previo = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'secreto-de-prueba';
    const { s, s3 } = armar();
    expect(await s.urlFirmadaDeImagen(tokenImagen(501, 1))).toBe('https://firmada/productos/empresa-89/extra-1.webp?x=1');
    expect(s3.getSignedGetUrl).toHaveBeenCalledWith('productos/empresa-89/extra-1.webp', 3600);
    await expect(s.urlFirmadaDeImagen(tokenImagen(501, 5))).rejects.toMatchObject({ response: { code: 'image_not_found' } });
    process.env.JWT_SECRET = previo;
  });
});

describe('la URL de las fotos', () => {
  it('https fuera de localhost (Railway llega como http detrás del proxy)', () => {
    expect(urlBaseDe({ headers: { host: 'api.krezka.com' } })).toBe('https://api.krezka.com');
    expect(urlBaseDe({ headers: { host: 'localhost:4131' } })).toBe('http://localhost:4131');
  });
});
