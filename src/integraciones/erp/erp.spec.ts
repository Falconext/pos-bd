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
    return { s: new ErpApiService(prisma, productos, {} as any, {} as any), prisma, productos };
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
    expect(() => leerAlta({ name: 'X', price: 10, cost_price: 5 })).toThrow(expect.objectContaining({ response: expect.objectContaining({ param: 'cost_price', code: 'unknown_parameter' }) }));
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
  function armar(o: { stockActual?: number | null; rubro?: string; variantes?: number; servicio?: boolean } = {}) {
    const prisma: any = {
      empresa: {
        findFirst: jest.fn(async () => ({ id: 89 })),
        findUnique: jest.fn(async () => ({ rubro: { nombre: o.rubro ?? 'Tienda' } })),
      },
      sede: { findFirst: jest.fn(async ({ where }: any) => (where.id === 99 ? null : { id: where.id ?? 16 })) },
      marca: { findFirst: jest.fn(async () => null) },
      productoCodigoBarras: { findMany: jest.fn(async () => []) },
      productoLote: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
      categoria: { findFirst: jest.fn(async ({ where }: any) => (where.id === 7 ? { id: 7 } : null)) },
      unidadMedida: { findFirst: jest.fn(async ({ where }: any) => (where.codigo === 'NIU' ? { id: 1 } : null)) },
      producto: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.codigo && !where.id) return where.codigo === 'USADO' ? { id: 77 } : null;
          if (where.codigo && where.id?.not) return where.codigo === 'USADO' ? { id: 77 } : null;
          return where.id === 501
            ? {
                ...PRODUCTO,
                id: 501,
                productoPadreId: null,
                atributosTecnicos: o.servicio ? { tipoProducto: 'SERVICIO' } : null,
                _count: { variantes: o.variantes ?? 0 },
              }
            : null;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          where.OR ? (where.OR.some((c: any) => c.codigo?.in?.includes('USADO')) ? [{ id: 77, codigo: 'USADO' }] : []) : [{ id: 601, valoresAtributos: { Talla: 'M' } }],
        ),
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
    const lotes: any = { crearLote: jest.fn(async () => ({})), aumentarStockLote: jest.fn(), descontarStockLote: jest.fn() };
    const kardex: any = { registrarMovimiento: jest.fn(async () => ({ id: 9 })) };
    return { s: new ErpApiService(prisma, productos, lotes, kardex), prisma, productos, lotes, kardex };
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

describe('cada rubro', () => {
  it('servicio: sin stock, sin lotes, sin presentaciones', () => {
    expect(leerAlta({ name: 'Cambio de aceite', price: 80, type: 'service' })).toMatchObject({ esServicio: true });
    expect(() => leerAlta({ name: 'X', price: 1, type: 'service', stock: 3 })).toThrow(/servicio no tiene stock/);
    expect(() => leerAlta({ name: 'X', price: 1, type: 'servicio' })).toThrow(/`product` o `service`/);
  });

  it('variantes: el stock va en cada una y la combinación tiene que existir', () => {
    const a = leerAlta({
      name: 'Polo', price: 40,
      variant_options: [{ name: 'Talla', values: ['S', 'M'] }, { name: 'Color', values: ['Negro'] }],
      variants: [{ attributes: { talla: 'm', COLOR: 'negro' }, sku: 'POLO-M-N', stock: 4 }],
    });
    expect(a.variantes).toEqual([{ valores: { Talla: 'M', Color: 'Negro' }, codigo: 'POLO-M-N', codigoBarras: undefined, precio: undefined, stock: 4 }]);
    expect(() => leerAlta({ name: 'P', price: 1, variants: [] })).toThrow(/primero define `variant_options`/);
    expect(() => leerAlta({ name: 'P', price: 1, stock: 5, variant_options: [{ name: 'Talla', values: ['S'] }] })).toThrow(/stock va en cada una/);
    expect(() =>
      leerAlta({ name: 'P', price: 1, variant_options: [{ name: 'Talla', values: ['S'] }], variants: [{ attributes: { Talla: 'XL' } }] }),
    ).toThrow(/Talla "XL" no está en variant_options \(S\)/);
    expect(() =>
      leerAlta({ name: 'P', price: 1, variant_options: [{ name: 'Talla', values: ['S', 's'] }] }),
    ).toThrow(/repetido/);
    expect(() =>
      leerAlta({ name: 'P', price: 1, variant_options: [{ name: 'A', values: Array.from({ length: 30 }, (_, i) => `a${i}`) }, { name: 'B', values: Array.from({ length: 10 }, (_, i) => `b${i}`) }] }),
    ).toThrow(/300 combinaciones; el máximo es 200/);
  });

  it('farmacia: campos propios y lote con vencimiento', () => {
    const a = leerAlta({
      name: 'Paracetamol 500mg x100', price: 12, stock: 50,
      batch: { number: 'L2401', expires_on: '2027-05-31', cost: 6 },
      pharmacy: { active_ingredient: 'Paracetamol', concentration: '500 mg', requires_prescription: false, digemid_code: 'E-123' },
    });
    expect(a.lote).toMatchObject({ numero: 'L2401', costo: 6 });
    expect(a.farmacia).toEqual({ principioActivo: 'Paracetamol', concentracion: '500 mg', codigoDigemid: 'E-123', requiereReceta: false });
    expect(() => leerAlta({ name: 'X', price: 1, stock: 5, batch: { number: 'L1', expires_on: '31/05/2027' } })).toThrow(/YYYY-MM-DD/);
    expect(() => leerAlta({ name: 'X', price: 1, pharmacy: { dosis: '1' } })).toThrow(/pharmacy.dosis/);
    expect(() => leerAlta({ name: 'X', price: 1, batch: { number: 'L1', expires_on: '2027-01-01' } })).toThrow(/manda también `stock`/);
  });

  it('bodega y ferretería: presentaciones y precios por mayor', () => {
    const a = leerAlta({
      name: 'Cerveza Pilsen 355ml', price: 4.5,
      packs: [{ barcode: '7750000000123', units: 6, price: 24, name: 'Six pack' }],
      wholesale_prices: [{ min_quantity: 24, price: 4 }, { min_quantity: 12, price: 4.2 }],
    });
    expect(a.presentaciones).toEqual([{ codigo: '7750000000123', unidadesPorPaquete: 6, precioPaquete: 24, alias: 'Six pack' }]);
    expect(a.preciosMayorista?.map((x) => x.cantidadMinima)).toEqual([12, 24]);
    expect(() => leerAlta({ name: 'X', price: 1, packs: [{ barcode: '1', units: 1, price: 1 }] })).toThrow(/units/);
    expect(() => leerAlta({ name: 'X', price: 1, wholesale_prices: [{ min_quantity: 12, price: 1 }, { min_quantity: 12, price: 2 }] })).toThrow(/dos precios/);
  });

  it('lo que no se maneja así dice dónde va', () => {
    expect(() => leerAlta({ name: 'X', price: 1, components: [1, 2] })).toThrow(/Combos/);
    expect(() => leerAlta({ name: 'X', price: 1, image_url: 'https://x' })).toThrow(/`images`/);
    expect(() => leerAlta({ name: 'X', price: 1, expiration_date: '2027-01-01' })).toThrow(/dentro de `batch`/);
    expect(() => leerAlta({ name: 'X', price: '12.5' })).toThrow(/sin comillas/);
    expect(() => leerAlta({ name: 'X', price: 1, images: ['http://inseguro.com/a.jpg'] })).toThrow(/https/);
    expect(() => leerCambio({ variants: [] })).toThrow(/usa el panel/);
    expect(() => leerCambio({ type: 'service' })).toThrow(/no se cambia/);
  });

  it('ajuste con lote: solo con change', () => {
    expect(leerAjuste({ change: 10, reason: 'found', batch: { number: 'L1', expires_on: '2027-01-01' } }).lote?.numero).toBe('L1');
    expect(() => leerAjuste({ quantity: 10, reason: 'found', batch: { number: 'L1' } })).toThrow(/usa `change`/);
  });
});

describe('reglas que dependen del negocio', () => {
  function armar(o: { rubro?: string; variantes?: number; servicio?: boolean; conLotes?: number } = {}) {
    const prisma: any = {
      empresa: { findFirst: jest.fn(async () => ({ id: 89 })), findUnique: jest.fn(async () => ({ rubro: { nombre: o.rubro ?? 'Tienda de ropa' } })) },
      sede: { findFirst: jest.fn(async () => ({ id: 16 })) },
      producto: {
        findFirst: jest.fn(async () => ({ id: 501, codigo: 'P', precioUnitario: 10, productoPadreId: null, atributosTecnicos: o.servicio ? { tipoProducto: 'SERVICIO' } : null, _count: { variantes: o.variantes ?? 0 } })),
        findMany: jest.fn(async () => [{ id: 601, valoresAtributos: { Talla: 'M' } }]),
      },
      productoLote: { count: jest.fn(async () => o.conLotes ?? 0) },
      productoStock: { findUnique: jest.fn(async () => ({ stock: 5 })) },
    };
    return new ErpApiService(prisma, {} as any, {} as any, {} as any);
  }

  it('farmacia sin lote: explica cómo mandarlo', async () => {
    await expect(armar({ rubro: 'Farmacia' }).crearProducto(89, { name: 'X', price: 1, stock: 5 }, 'x')).rejects.toMatchObject({
      response: { code: 'batch_required', param: 'batch' },
    });
    await expect(armar({ rubro: 'Botica' }).ajustarStock(89, 501, { change: 5, reason: 'found' })).rejects.toMatchObject({
      response: { code: 'batch_required' },
    });
  });

  it('droguería también exige lote; fabricación lo acepta pero no lo exige', async () => {
    await expect(
      armar({ rubro: 'Droguería y Distribuidora Farmacéutica' }).crearProducto(89, { name: 'X', price: 1, stock: 5 }, 'x'),
    ).rejects.toMatchObject({ response: { code: 'batch_required' } });
    // Fabricación sin lote: no es este error (sigue al alta, que acá no está armada).
    await expect(
      armar({ rubro: 'Fabricación y producción' }).crearProducto(89, { name: 'X', price: 1, stock: 5 }, 'x'),
    ).rejects.not.toMatchObject({ response: { code: 'batch_required' } });
  });

  it('un producto que ya tiene lotes se ajusta por lote en cualquier rubro', async () => {
    await expect(armar({ rubro: 'Fabricación y producción', conLotes: 2 }).ajustarStock(89, 501, { change: 1, reason: 'found' })).rejects.toMatchObject({
      response: { code: 'batch_required', message: expect.stringContaining('Este producto se maneja por lotes') },
    });
  });

  it('una tienda de ropa no maneja lotes', async () => {
    await expect(
      armar().crearProducto(89, { name: 'X', price: 1, stock: 5, batch: { number: 'L1', expires_on: '2027-01-01' } }, 'x'),
    ).rejects.toMatchObject({ response: { code: 'batches_not_enabled' } });
  });

  it('el stock del producto con variantes se ajusta en cada variante, y dice sus ids', async () => {
    await expect(armar({ variantes: 2 }).ajustarStock(89, 501, { change: 1, reason: 'found' })).rejects.toMatchObject({
      response: { code: 'product_has_variants', message: expect.stringContaining('601 = M') },
    });
  });

  it('un servicio no tiene stock', async () => {
    await expect(armar({ servicio: true }).ajustarStock(89, 501, { change: 1, reason: 'found' })).rejects.toMatchObject({
      response: { code: 'service_has_no_stock' },
    });
  });

  it('más fotos de las que admite el panel', async () => {
    const fotos = ['https://a.com/1.jpg', 'https://a.com/2.jpg', 'https://a.com/3.jpg', 'https://a.com/4.jpg'];
    await expect(armar().crearProducto(89, { name: 'X', price: 1, images: fotos }, 'x')).rejects.toMatchObject({
      response: { param: 'images', message: expect.stringContaining('hasta 3 fotos') },
    });
  });
});
