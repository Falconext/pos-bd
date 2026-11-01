/**
 * Tienda virtual por sede, de punta a punta en el servicio: catálogo, filtros,
 * ficha, carrito, pedido, vínculo con el comprobante, listado de pedidos y la
 * configuración del panel.
 *
 * Escenario (Krezka): dos sedes. El Polo tiene 2 en Centro y 8 en Norte
 * (Producto.stock = 10, la suma). La Gorra tiene 5 en Centro y en Norte está
 * marcada como no vendible.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TiendaService } from './tienda.service';
import { MENSAJES_STOCK_TIENDA } from './stock-tienda';

const CENTRO = {
  id: 1,
  nombre: 'Centro',
  direccion: 'Jr. Lima 100',
  ubigeo: null,
  esPrincipal: true,
};
const NORTE = {
  id: 2,
  nombre: 'Norte',
  direccion: 'Av. Túpac 500',
  ubigeo: null,
  esPrincipal: false,
};

const POLO = {
  id: 7,
  descripcion: 'Polo',
  precioUnitario: 50,
  stock: 10,
  porcentajeProvision: 0,
  atributosTecnicos: {},
  productoPadreId: null,
};
const GORRA = {
  id: 8,
  descripcion: 'Gorra',
  precioUnitario: 20,
  stock: 5,
  porcentajeProvision: 0,
  atributosTecnicos: {},
  productoPadreId: null,
};

type Fila = {
  productoId: number;
  sedeId: number;
  stock: number;
  visibleEnSede?: boolean;
  vendibleEnSede?: boolean;
};
const FILAS_BASE: Fila[] = [
  { productoId: 7, sedeId: 1, stock: 2 },
  { productoId: 7, sedeId: 2, stock: 8 },
  { productoId: 8, sedeId: 1, stock: 5 },
  { productoId: 8, sedeId: 2, stock: 0, vendibleEnSede: false },
];

function armar(
  opts: {
    modo?: 'SEDE' | 'CLIENTE' | 'TODAS';
    tiendaSedeId?: number | null;
    tiendaSedesIds?: number[];
    sinStock?: boolean;
    sedes?: any[];
    filas?: Fila[];
    reservas?: Array<{ productoId: number; sedeId: number; cantidad: number }>;
    pedido?: any;
    comprobante?: any;
    sedesValidas?: number[];
  } = {},
) {
  const filas = opts.filas ?? FILAS_BASE;
  const sedes = opts.sedes ?? [CENTRO, NORTE];
  const productos = [POLO, GORRA];
  const empresa = {
    id: 9,
    costoEnvioFijo: 0,
    envioGratisDesdeSoles: 0,
    minimoCompra: 0,
    aceptaRecojo: true,
    aceptaEnvio: true,
    tiendaVentaSinStock: opts.sinStock ?? false,
    nombreComercial: 'Krezka',
    razonSocial: 'KREZKA S.A.C.',
    mpConectado: false,
    couriersTienda: [],
    tiendaStockModo: opts.modo ?? 'SEDE',
    tiendaSedeId: opts.tiendaSedeId ?? null,
    tiendaSedesIds: opts.tiendaSedesIds ?? [],
    tiendaStockModoElegidoEn: null,
    plan: { tieneTienda: true },
    banners: [],
    rubro: null,
  };
  const creado: any = {};
  const actualizado: any = {};
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue(empresa),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ ...empresa, ...data }),
        ),
    },
    sede: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.id?.in) {
          const validas = opts.sedesValidas ?? sedes.map((s) => s.id);
          return Promise.resolve(
            where.id.in
              .filter((id: number) => validas.includes(id))
              .map((id: number) => ({ id })),
          );
        }
        return Promise.resolve(sedes);
      }),
    },
    producto: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where?.id?.in
              ? productos.filter((p) => where.id.in.includes(p.id))
              : productos,
          ),
        ),
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where.productoPadreId !== undefined) return Promise.resolve(null);
        return Promise.resolve(
          productos.find((p) => p.id === where.id) ?? null,
        );
      }),
      aggregate: jest
        .fn()
        .mockResolvedValue({
          _min: { precioUnitario: 20 },
          _max: { precioUnitario: 50 },
        }),
    },
    productoStock: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            filas
              .filter(
                (f) =>
                  where.productoId.in.includes(f.productoId) &&
                  where.sedeId.in.includes(f.sedeId),
              )
              .map((f) => ({
                visibleEnSede: true,
                vendibleEnSede: true,
                ...f,
              })),
          ),
        ),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    reserva: {
      groupBy: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            (opts.reservas ?? [])
              .filter((r) => where.sedeId.in.includes(r.sedeId))
              .map((r) => ({
                productoId: r.productoId,
                sedeId: r.sedeId,
                _sum: { cantidad: r.cantidad },
              })),
          ),
        ),
    },
    ubigeo: { findMany: jest.fn().mockResolvedValue([]) },
    productoReview: { groupBy: jest.fn().mockResolvedValue([]) },
    combo: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 30,
            nombre: 'Pack polos',
            items: [
              { productoId: 7, cantidad: 2, producto: { id: 7, stock: 10 } },
            ],
          },
        ]),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 30, items: [{ productoId: 7, cantidad: 2 }] }),
    },
    productoCodigoBarras: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    historialEstadoPedido: { create: jest.fn().mockResolvedValue({}) },
    pedidoTienda: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(creado, data);
        return Promise.resolve({ id: 1, ...data, items: [] });
      }),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where?.NOT
              ? null
              : (opts.pedido ?? {
                  id: 1,
                  estado: 'PENDIENTE',
                  comprobanteId: null,
                  total: 100,
                  montoPagado: 0,
                  sedeId: null,
                  sede: null,
                }),
          ),
        ),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(actualizado, data);
        return Promise.resolve({ id: 1, ...data });
      }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    comprobante: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.comprobante ?? {
            id: 900,
            serie: 'NV01',
            correlativo: 3,
            mtoImpVenta: 100,
            saldo: 0,
            sedeId: 1,
            sede: { nombre: 'Centro' },
          },
        ),
    },
    $transaction: jest
      .fn()
      .mockImplementation((ops: any[]) => Promise.all(ops)),
  };
  const noop: any = new Proxy({}, { get: () => jest.fn() });
  const s3: any = { getSignedGetUrl: jest.fn().mockResolvedValue('firmada') };
  const diseno: any = {
    obtenerDisenoPorEmpresa: jest.fn().mockResolvedValue({}),
  };
  const service = new TiendaService(prisma, s3, diseno, noop, noop, noop, noop);
  return { service, prisma, creado, actualizado };
}

const pedido = (items: any[], extra: any = {}) =>
  ({
    clienteNombre: 'Ana',
    clienteTelefono: '999888777',
    tipoEntrega: 'RECOJO',
    medioPago: 'EFECTIVO',
    items,
    ...extra,
  }) as any;

const stockDe = (r: any, id: number) => r.data.find((p: any) => p.id === id);

describe('Tienda por sede · catálogo', () => {
  it('SEDE (principal): el stock es el de Centro, no la suma', async () => {
    const { service } = armar({ modo: 'SEDE' });
    const r: any = await service.obtenerProductosTienda('krezka');
    expect(stockDe(r, 7)).toMatchObject({ stock: 2, vendible: true });
    expect(stockDe(r, 8)).toMatchObject({ stock: 5, vendible: true });
  });

  it('SEDE ignora ?sede del comprador', async () => {
    const { service } = armar({ modo: 'SEDE', tiendaSedeId: 1 });
    const r: any = await service.obtenerProductosTienda(
      'krezka',
      1,
      30,
      '',
      '',
      undefined,
      undefined,
      '',
      false,
      '',
      '2',
    );
    expect(stockDe(r, 7).stock).toBe(2);
  });

  it('CLIENTE ?sede=2: stock de Norte; lo no vendible ahí sale en 0 y no vendible', async () => {
    const { service, prisma } = armar({ modo: 'CLIENTE' });
    const r: any = await service.obtenerProductosTienda(
      'krezka',
      1,
      30,
      '',
      '',
      undefined,
      undefined,
      '',
      false,
      '',
      '2',
    );
    expect(stockDe(r, 7)).toMatchObject({ stock: 8, vendible: true });
    expect(stockDe(r, 8)).toMatchObject({ stock: 0, vendible: false });
    // El filtro de visibilidad es el de la sede elegida.
    const where = prisma.producto.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"sedeId":2,"visibleEnSede":false');
  });

  it('TODAS: suma lo vendible de las sedes habilitadas', async () => {
    const { service } = armar({ modo: 'TODAS' });
    const r: any = await service.obtenerProductosTienda('krezka');
    expect(stockDe(r, 7).stock).toBe(10);
    expect(stockDe(r, 8).stock).toBe(5);
  });

  it('las reservas de la sede bajan el stock que ve el comprador', async () => {
    const { service } = armar({
      modo: 'SEDE',
      reservas: [{ productoId: 7, sedeId: 1, cantidad: 1 }],
    });
    const r: any = await service.obtenerProductosTienda('krezka');
    expect(stockDe(r, 7).stock).toBe(1);
  });

  it('filtros coherentes: categorías, marcas y precios usan el mismo conjunto que el listado', async () => {
    const { service, prisma } = armar({ modo: 'CLIENTE' });
    await service.obtenerProductosTienda(
      'krezka',
      1,
      30,
      '',
      '',
      undefined,
      undefined,
      '',
      false,
      '',
      '2',
    );
    const whereListado = prisma.producto.count.mock.calls[1][0].where;
    prisma.producto.findMany.mockResolvedValue([]);
    await service.obtenerCategoriasTienda('krezka', '2');
    await service.obtenerMarcasTienda('krezka', '2');
    await service.obtenerRangoPreciosTienda('krezka', '2');
    const [cats, marcas] = prisma.producto.findMany.mock.calls
      .slice(-2)
      .map((c: any[]) => c[0].where);
    const precios = prisma.producto.aggregate.mock.calls[0][0].where;
    const sinFiltrosDelComprador = { ...whereListado };
    expect(cats).toEqual(sinFiltrosDelComprador);
    expect(precios).toEqual(sinFiltrosDelComprador);
    expect(marcas).toEqual({
      ...sinFiltrosDelComprador,
      marcaId: { not: null },
    });
    // Ya no hay `stock > 0` suelto: los agotados del listado tienen su marca.
    expect(JSON.stringify(marcas)).not.toContain('"gt":0');
  });
});

describe('Tienda por sede · ficha', () => {
  it('CLIENTE: stock de la sede elegida y "Disponible en" las otras', async () => {
    const { service } = armar({ modo: 'CLIENTE' });
    const p: any = await service.obtenerProductoDetalle('krezka', 7, '1');
    expect(p.stock).toBe(2);
    expect(p.disponibleEn).toEqual([{ sedeId: 2, nombre: 'Norte', stock: 8 }]);
  });

  it('CLIENTE: oculto en la sede elegida pero existe en otra → ficha sin stock, no 404', async () => {
    const filas = FILAS_BASE.map((f) =>
      f.productoId === 7 && f.sedeId === 1 ? { ...f, visibleEnSede: false } : f,
    );
    const { service } = armar({ modo: 'CLIENTE', filas });
    const p: any = await service.obtenerProductoDetalle('krezka', 7, '1');
    expect(p).toMatchObject({
      stock: 0,
      vendible: false,
      disponibleEn: [{ sedeId: 2, nombre: 'Norte', stock: 8 }],
    });
  });

  it('SEDE: oculto en la sede de la tienda → 404', async () => {
    const filas = FILAS_BASE.map((f) =>
      f.productoId === 7 && f.sedeId === 1 ? { ...f, visibleEnSede: false } : f,
    );
    const { service } = armar({ modo: 'SEDE', filas });
    await expect(
      service.obtenerProductoDetalle('krezka', 7),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('TODAS: disponibleEn vacío (no hay sede elegida)', async () => {
    const { service } = armar({ modo: 'TODAS' });
    const p: any = await service.obtenerProductoDetalle('krezka', 7);
    expect(p).toMatchObject({ stock: 10, disponibleEn: [] });
  });
});

describe('Tienda por sede · pedido', () => {
  it('SEDE: el pedido queda en la sede y se valida con SU stock (no con la suma)', async () => {
    const { service, creado } = armar({ modo: 'SEDE' });
    await expect(
      service.crearPedido('krezka', pedido([{ productoId: 7, cantidad: 3 }])),
    ).rejects.toThrow('Stock insuficiente para Polo en Centro. Disponible: 2');
    await service.crearPedido(
      'krezka',
      pedido([{ productoId: 7, cantidad: 2 }]),
    );
    expect(creado.sedeId).toBe(1);
  });

  it('dos líneas del mismo producto se validan juntas', async () => {
    const { service } = armar({ modo: 'SEDE' });
    await expect(
      service.crearPedido(
        'krezka',
        pedido([
          { productoId: 7, cantidad: 1 },
          { productoId: 7, cantidad: 2 },
        ]),
      ),
    ).rejects.toThrow('Disponible: 2');
  });

  it('CLIENTE sin sede (con varias habilitadas) → 400', async () => {
    const { service, prisma } = armar({ modo: 'CLIENTE' });
    await expect(
      service.crearPedido('krezka', pedido([{ productoId: 7, cantidad: 1 }])),
    ).rejects.toThrow(MENSAJES_STOCK_TIENDA.elegirSede);
    expect(prisma.pedidoTienda.create).not.toHaveBeenCalled();
  });

  it('CLIENTE con sede no habilitada o de otra empresa → 400', async () => {
    const { service } = armar({
      modo: 'CLIENTE',
      tiendaSedesIds: [1],
      sedes: [CENTRO, NORTE],
    });
    await expect(
      service.crearPedido(
        'krezka',
        pedido([{ productoId: 7, cantidad: 1 }], { sedeId: 2 }),
      ),
    ).rejects.toThrow(MENSAJES_STOCK_TIENDA.sedeNoHabilitada);
    await expect(
      service.crearPedido(
        'krezka',
        pedido([{ productoId: 7, cantidad: 1 }], { sedeId: 555 }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('CLIENTE: queda en la sede elegida y valida con ella', async () => {
    const { service, creado } = armar({ modo: 'CLIENTE' });
    await service.crearPedido(
      'krezka',
      pedido([{ productoId: 7, cantidad: 8 }], { sedeId: 2 }),
    );
    expect(creado.sedeId).toBe(2);
  });

  it('CLIENTE con una sola sede habilitada no exige elegir', async () => {
    const { service, creado } = armar({ modo: 'CLIENTE', tiendaSedesIds: [2] });
    await service.crearPedido(
      'krezka',
      pedido([{ productoId: 7, cantidad: 1 }]),
    );
    expect(creado.sedeId).toBe(2);
  });

  it('TODAS: valida con la suma y el pedido queda sin sede', async () => {
    const { service, creado } = armar({ modo: 'TODAS' });
    await service.crearPedido(
      'krezka',
      pedido([{ productoId: 7, cantidad: 10 }]),
    );
    expect(creado.sedeId).toBeNull();
    const otro = armar({ modo: 'TODAS' });
    await expect(
      otro.service.crearPedido(
        'krezka',
        pedido([{ productoId: 7, cantidad: 11 }]),
      ),
    ).rejects.toThrow('Disponible: 10');
  });

  it('no vendible en la sede: se rechaza aunque la tienda venda sin stock', async () => {
    const { service } = armar({ modo: 'CLIENTE', sinStock: true });
    await expect(
      service.crearPedido(
        'krezka',
        pedido([{ productoId: 8, cantidad: 1 }], { sedeId: 2 }),
      ),
    ).rejects.toThrow('Gorra no está disponible en Norte.');
  });

  it('vender sin stock: con la sede corta, el pedido entra igual', async () => {
    const { service, creado } = armar({ modo: 'SEDE', sinStock: true });
    await service.crearPedido(
      'krezka',
      pedido([{ productoId: 7, cantidad: 9 }]),
    );
    expect(creado.sedeId).toBe(1);
  });

  it('varias sedes y el producto sin fila en la sede: stock 0, no la suma global', async () => {
    const { service } = armar({
      modo: 'SEDE',
      tiendaSedeId: 2,
      filas: FILAS_BASE.filter((f) => f.sedeId !== 2),
    });
    await expect(
      service.crearPedido('krezka', pedido([{ productoId: 7, cantidad: 1 }])),
    ).rejects.toThrow('Disponible: 0');
  });
});

describe('Tienda por sede · carrito', () => {
  it('revalida por ítem con la sede elegida', async () => {
    const { service } = armar({ modo: 'CLIENTE' });
    const r: any = await service.disponibilidadCarrito('krezka', {
      sedeId: 2,
      items: [
        { productoId: 7, cantidad: 9 },
        { productoId: 8, cantidad: 1 },
        { productoId: 999, cantidad: 1 },
        { comboId: 30, cantidad: 1 },
      ],
    });
    expect(r).toMatchObject({
      modo: 'CLIENTE',
      sedeId: 2,
      ventaSinStock: false,
    });
    expect(r.items[0]).toMatchObject({
      productoId: 7,
      stock: 8,
      disponible: false,
      motivo: 'SIN_STOCK',
    });
    expect(r.items[1]).toMatchObject({
      productoId: 8,
      disponible: false,
      motivo: 'NO_VENDIBLE',
    });
    expect(r.items[2]).toMatchObject({
      disponible: false,
      motivo: 'NO_EXISTE',
    });
    // El combo pide 2 Polos más: 9 + 2 = 11 > 8 → tampoco alcanza; arma 4.
    expect(r.items[3]).toMatchObject({
      comboId: 30,
      stock: 4,
      disponible: false,
      motivo: 'SIN_STOCK',
    });
  });

  it('cambiar de sede cambia la respuesta; vender sin stock deja pasar lo agotado', async () => {
    const { service } = armar({ modo: 'CLIENTE', sinStock: true });
    const r: any = await service.disponibilidadCarrito('krezka', {
      sedeId: 1,
      items: [{ productoId: 7, cantidad: 9 }],
    });
    expect(r.items[0]).toMatchObject({
      stock: 2,
      disponible: true,
      motivo: null,
    });
  });

  it('sede no habilitada → 400; en SEDE el sedeId se ignora', async () => {
    const cliente = armar({ modo: 'CLIENTE', tiendaSedesIds: [1] });
    await expect(
      cliente.service.disponibilidadCarrito('krezka', {
        sedeId: 2,
        items: [{ productoId: 7, cantidad: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const sede = armar({ modo: 'SEDE' });
    const r: any = await sede.service.disponibilidadCarrito('krezka', {
      sedeId: 2,
      items: [{ productoId: 7, cantidad: 1 }],
    });
    expect(r).toMatchObject({
      sedeId: 1,
      items: [{ stock: 2, disponible: true }],
    });
  });
});

describe('Tienda por sede · combos y tienda pública', () => {
  it('combos traen el stock de la sede en sus productos y cuántos se arman', async () => {
    const { service } = armar({ modo: 'CLIENTE' });
    const r: any = await service.obtenerCombosTienda('krezka', '1');
    expect(r.data[0]).toMatchObject({ stockDisponible: 1, vendible: true });
    expect(r.data[0].items[0].producto.stock).toBe(2);
    const st: any = await service.verificarStockCombo('krezka', 30, '2');
    expect(st.data).toMatchObject({
      comboId: 30,
      stockDisponible: 4,
      vendible: true,
    });
  });

  it('GET tienda: stockTienda con modo, sede por defecto y sedes habilitadas', async () => {
    const { service } = armar({ modo: 'CLIENTE', tiendaSedeId: 2 });
    const t: any = await service.obtenerTiendaPorSlug('krezka');
    expect(t.stockTienda).toEqual({
      modo: 'CLIENTE',
      sedeDefaultId: 2,
      sedes: [
        {
          id: 1,
          nombre: 'Centro',
          direccion: 'Jr. Lima 100',
          distrito: null,
          provincia: null,
          departamento: null,
          esPrincipal: true,
        },
        {
          id: 2,
          nombre: 'Norte',
          direccion: 'Av. Túpac 500',
          distrito: null,
          provincia: null,
          departamento: null,
          esPrincipal: false,
        },
      ],
    });
    // La config interna no sale tal cual.
    expect(t.tiendaSedesIds).toBeUndefined();
    expect(t.tiendaStockModo).toBeUndefined();
  });
});

describe('Tienda por sede · vincular comprobante del punto de venta', () => {
  it('pedido de Norte y comprobante de Centro → 409', async () => {
    const { service, prisma } = armar({
      pedido: {
        id: 1,
        estado: 'PENDIENTE',
        comprobanteId: null,
        total: 100,
        montoPagado: 0,
        sedeId: 2,
        sede: { nombre: 'Norte' },
      },
    });
    await expect(service.vincularComprobante(9, 1, 900)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.vincularComprobante(9, 1, 900)).rejects.toThrow(
      'Este pedido es de la sede Norte y el comprobante salió de Centro.',
    );
    expect(prisma.pedidoTienda.update).not.toHaveBeenCalled();
  });

  it('misma sede: vincula', async () => {
    const { service, actualizado } = armar({
      pedido: {
        id: 1,
        estado: 'PENDIENTE',
        comprobanteId: null,
        total: 100,
        montoPagado: 0,
        sedeId: 1,
        sede: { nombre: 'Centro' },
      },
    });
    await service.vincularComprobante(9, 1, 900);
    expect(actualizado.comprobanteId).toBe(900);
    expect(actualizado.sedeId).toBeUndefined();
  });

  it('pedido sin sede (TODAS): queda en la sede del comprobante', async () => {
    const { service, actualizado } = armar();
    await service.vincularComprobante(9, 1, 900);
    expect(actualizado.sedeId).toBe(1);
  });
});

describe('Tienda por sede · panel', () => {
  it('listado de pedidos: filtro por sede, "sin-sede" y la sede en cada pedido', async () => {
    const { service, prisma } = armar();
    await service.listarPedidos(9, undefined, 1, 50, '2');
    expect(prisma.pedidoTienda.findMany.mock.calls[0][0].where).toEqual({
      empresaId: 9,
      sedeId: 2,
    });
    expect(prisma.pedidoTienda.findMany.mock.calls[0][0].include.sede).toEqual({
      select: { id: true, nombre: true },
    });
    await service.listarPedidos(9, 'PENDIENTE', 1, 50, 'sin-sede');
    expect(prisma.pedidoTienda.findMany.mock.calls[1][0].where).toEqual({
      empresaId: 9,
      estado: 'PENDIENTE',
      sedeId: null,
    });
    await expect(
      service.listarPedidos(9, undefined, 1, 50, 'abc'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('config: sedes de otra empresa o inactivas → 400 sin guardar', async () => {
    const { service, prisma } = armar({ sedesValidas: [1] });
    await expect(
      service.configurarTienda(9, {
        tiendaStockModo: 'CLIENTE',
        tiendaSedesIds: [1, 2],
      }),
    ).rejects.toThrow(
      'Las sedes de la tienda deben ser de tu empresa y estar activas.',
    );
    await expect(
      service.configurarTienda(9, { tiendaSedeId: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('config: guarda modo y sedes (sin repetidos) y marca que el dueño eligió', async () => {
    const { service, prisma } = armar();
    await service.configurarTienda(9, {
      tiendaStockModo: 'CLIENTE',
      tiendaSedeId: 2,
      tiendaSedesIds: [2, 1, 2],
    });
    const data = prisma.empresa.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tiendaStockModo: 'CLIENTE',
      tiendaSedeId: 2,
      tiendaSedesIds: [2, 1],
    });
    expect(data.tiendaStockModoElegidoEn).toBeInstanceOf(Date);
    // Volver a "la principal" y "todas": null y [] no consultan sedes.
    prisma.sede.findMany.mockClear();
    await service.configurarTienda(9, {
      tiendaSedeId: null,
      tiendaSedesIds: [],
    });
    expect(prisma.sede.findMany).not.toHaveBeenCalled();
    expect(
      prisma.empresa.update.mock.calls[1][0].data.tiendaStockModoElegidoEn,
    ).toBeUndefined();
  });

  it('config-envio no deja colar la config de stock sin validar', async () => {
    const { service, prisma } = armar();
    await service.actualizarConfiguracionEnvio(9, {
      aceptaRecojo: false,
      tiendaSedeId: 999,
      tiendaStockModo: 'TODAS',
    });
    expect(prisma.empresa.update.mock.calls[0][0].data).toEqual({
      aceptaRecojo: false,
    });
  });
});
