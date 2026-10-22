/**
 * La API de Krezka para el propio negocio (2026-10-22): varios clientes
 * pidieron mostrar sus productos en su página web, con precio y stock al día,
 * leyéndolos de Krezka.
 */
import { leerAjuste, leerAlta, leerCambio } from './entrada-producto';
import { precioDeOferta, serializarProducto, stockDe } from './serializar-producto';
import { ErpApiService } from './erp.service';
import { urlBaseDe } from './erp.controller';

const URL_IMG = (u: string) => `img:${u.split('/').pop()}`;

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
      images: ['img:p501.webp', 'img:extra-1.webp'],
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

  it('la oferta vale si es menor que el precio y está en fechas (la regla de la tienda)', () => {
    const ahora = new Date('2026-10-22T12:00:00Z');
    expect(precioDeOferta({ precioUnitario: 31, precioOferta: 25 }, ahora)).toBe(25);
    expect(precioDeOferta({ precioUnitario: 31, precioOferta: 31 }, ahora)).toBeNull();
    expect(precioDeOferta({ precioUnitario: 31, precioOferta: 0 }, ahora)).toBeNull();
    expect(precioDeOferta({ precioUnitario: 31, precioOferta: 25, fechaFinOferta: new Date('2026-10-21') }, ahora)).toBeNull();
    expect(precioDeOferta({ precioUnitario: 31, precioOferta: 25, fechaInicioOferta: new Date('2026-10-30') }, ahora)).toBeNull();
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
    const productos: any = { crear: jest.fn(), actualizar: jest.fn() };
    return { s: new ErpApiService(prisma, productos), prisma, productos };
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

  it('las fotos van por la ruta pública que ya usa el SEO, en tamaño original', async () => {
    const { s } = armar();
    const r: any = await s.listarProductos(89, { limit: 1 }, 'https://api.krezka.com');
    expect(r.data[0].images).toEqual([
      'https://api.krezka.com/api/public/img/productos/empresa-89/p501.webp',
      'https://api.krezka.com/api/public/img/productos/empresa-89/extra-1.webp',
    ]);
  });
});

describe('la URL de las fotos', () => {
  it('https fuera de localhost (Railway llega como http detrás del proxy)', () => {
    expect(urlBaseDe({ headers: { host: 'api.krezka.com' } })).toBe('https://api.krezka.com');
    expect(urlBaseDe({ headers: { host: 'localhost:4131' } })).toBe('http://localhost:4131');
  });
});

describe('lo que manda la web', () => {
  it('alta: nombre y precio bastan; el resto tiene valores por defecto', () => {
    expect(leerAlta({ name: ' Moringa 90 ', price: 31 })).toMatchObject({
      descripcion: 'Moringa 90',
      precioUnitario: 31,
      tipoAfectacionIGV: '10',
      moneda: 'PEN',
      stock: 0,
    });
    expect(leerAlta({ name: 'X', price: 10, tax: 'exempt', currency: 'usd', unit: 'kgm', stock: 5 })).toMatchObject({
      tipoAfectacionIGV: '20',
      moneda: 'USD',
      unidad: 'KGM',
      stock: 5,
    });
  });

  it('alta: dice qué campo está mal', () => {
    expect(() => leerAlta({ price: 10 })).toThrow(expect.objectContaining({ response: expect.objectContaining({ param: 'name' }) }));
    expect(() => leerAlta({ name: 'X', price: '10' })).toThrow(expect.objectContaining({ response: expect.objectContaining({ param: 'price' }) }));
    expect(() => leerAlta({ name: 'X', price: 10, sale_price: 12 })).toThrow(expect.objectContaining({ response: expect.objectContaining({ param: 'sale_price' }) }));
    expect(() => leerAlta({ name: 'X', price: 10, tax: 'iva' })).toThrow(expect.objectContaining({ response: expect.objectContaining({ param: 'tax' }) }));
    expect(() => leerAlta({ name: 'X', price: 10, cost: 5 })).toThrow(expect.objectContaining({ response: expect.objectContaining({ param: 'cost' }) }));
  });

  it('cambio: solo lo que viene; null quita la oferta; el stock no va acá', () => {
    expect(leerCambio({ price: 29.9, sale_price: null })).toEqual({ precioUnitario: 29.9, precioOferta: null });
    expect(leerCambio({ category_id: null })).toEqual({ categoriaId: null });
    expect(() => leerCambio({ stock: 5 })).toThrow(/stock_adjustments/);
    expect(() => leerCambio({})).toThrow(/ningún campo/);
  });

  it('ajuste: el stock final o cuánto cambiar, uno solo, con un motivo del kardex', () => {
    expect(leerAjuste({ quantity: 20, reason: 'stock_count' })).toMatchObject({ nuevo: 20, motivo: 'CONTEO', razon: 'stock_count' });
    expect(leerAjuste({ change: -2, reason: 'damaged', note: 'se rompió' })).toMatchObject({ cambio: -2, motivo: 'MERMA', nota: 'se rompió' });
    expect(() => leerAjuste({ quantity: 20, change: 2, reason: 'other' })).toThrow(/uno solo/);
    expect(() => leerAjuste({ change: 0, reason: 'other' })).toThrow(/distinto de 0/);
    expect(() => leerAjuste({ change: 1, reason: 'porque si' })).toThrow(/stock_count/);
  });
});

describe('escribir', () => {
  function armar(o: { stockActual?: number | null } = {}) {
    const prisma: any = {
      empresa: { findFirst: jest.fn(async () => ({ id: 89 })) },
      sede: { findFirst: jest.fn(async ({ where }: any) => (where.id === 99 ? null : { id: where.id ?? 16 })) },
      categoria: { findFirst: jest.fn(async ({ where }: any) => (where.id === 7 ? { id: 7 } : null)) },
      unidadMedida: { findFirst: jest.fn(async ({ where }: any) => (where.codigo === 'NIU' ? { id: 1 } : null)) },
      producto: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.codigo && !where.id) return where.codigo === 'USADO' ? { id: 77 } : null;
          if (where.codigo && where.id?.not) return where.codigo === 'USADO' ? { id: 77 } : null;
          return where.id === 501 ? { ...PRODUCTO, id: 501 } : null;
        }),
        findMany: jest.fn(async () => []),
      },
      productoStock: {
        upsert: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => (o.stockActual === null ? null : { stock: o.stockActual ?? 12 })),
      },
    };
    const productos: any = {
      crear: jest.fn(async () => ({ id: 501 })),
      actualizar: jest.fn(async () => ({})),
    };
    return { s: new ErpApiService(prisma, productos), prisma, productos };
  }

  it('crear usa el alta del panel y carga el stock inicial como ajuste en el kardex', async () => {
    const { s, prisma, productos } = armar();
    await s.crearProducto(89, { name: 'Moringa', price: 31, unit: 'NIU', category_id: 7, stock: 5 }, 'x');
    expect(productos.crear).toHaveBeenCalledWith(
      expect.objectContaining({ descripcion: 'Moringa', precioUnitario: 31, stock: 0, unidadMedidaId: 1, categoriaId: 7 }),
      89,
      16,
    );
    expect(prisma.productoStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productoId_sedeId: { productoId: 501, sedeId: 16 } } }),
    );
    expect(productos.actualizar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 501, empresaId: 89, sedeId: 16, stock: 5, motivoAjusteStock: 'OTRO' }),
      undefined,
    );
  });

  it('crear rechaza sku repetido, categoría ajena y unidad desconocida', async () => {
    const { s } = armar();
    await expect(s.crearProducto(89, { name: 'X', price: 1, sku: 'USADO' }, 'x')).rejects.toMatchObject({ response: { code: 'sku_taken' } });
    await expect(s.crearProducto(89, { name: 'X', price: 1, category_id: 8 }, 'x')).rejects.toMatchObject({ response: { code: 'category_not_found' } });
    await expect(s.crearProducto(89, { name: 'X', price: 1, unit: 'XYZ' }, 'x')).rejects.toMatchObject({ response: { param: 'unit' } });
  });

  it('editar pasa solo lo que cambió y no deja una oferta mayor que el precio', async () => {
    const { s, productos } = armar();
    await s.actualizarProducto(89, 501, { name: 'Moringa 90' }, 'x');
    expect(productos.actualizar).toHaveBeenCalledWith({ descripcion: 'Moringa 90', id: 501, empresaId: 89 }, undefined);
    await expect(s.actualizarProducto(89, 501, { sale_price: 40 }, 'x')).rejects.toMatchObject({ response: { param: 'sale_price' } });
    await expect(s.actualizarProducto(89, 999, { name: 'X' }, 'x')).rejects.toMatchObject({ response: { code: 'product_not_found' } });
  });

  it('ajustar: suma o deja en un número, y no deja stock negativo', async () => {
    const { s, productos } = armar({ stockActual: 12 });
    expect(await s.ajustarStock(89, 501, { change: -2, reason: 'damaged' })).toMatchObject({
      previous_quantity: 12,
      quantity: 10,
      change: -2,
      reason: 'damaged',
    });
    expect(productos.actualizar).toHaveBeenLastCalledWith(
      expect.objectContaining({ stock: 10, motivoAjusteStock: 'MERMA' }),
      undefined,
    );
    await expect(s.ajustarStock(89, 501, { change: -20, reason: 'damaged' })).rejects.toMatchObject({
      response: { code: 'insufficient_stock' },
    });
  });

  it('ajustar al mismo número no mueve nada', async () => {
    const { s, productos } = armar({ stockActual: 12 });
    expect(await s.ajustarStock(89, 501, { quantity: 12, reason: 'stock_count' })).toMatchObject({ change: 0 });
    expect(productos.actualizar).not.toHaveBeenCalled();
  });
});
