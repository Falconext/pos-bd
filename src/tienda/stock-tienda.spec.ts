/**
 * Stock de la tienda virtual por sede: la regla común (stock − reservas −
 * provisión), los tres modos y el filtro del catálogo.
 */
import { BadRequestException } from '@nestjs/common';
import {
  cargarStockPorSede,
  disponibleParaVenta,
} from '../common/utils/stock-disponible-sede';
import {
  MENSAJES_STOCK_TIENDA,
  StockTienda,
  disponibleEnOtrasSedes,
  mensajeSedeDistinta,
  resolverContextoStock,
  stockDeCombo,
  stockTiendaDe,
  type SedeTienda,
} from './stock-tienda';

const CENTRO: SedeTienda = {
  id: 1,
  nombre: 'Centro',
  direccion: 'Jr. Lima 100',
  ubigeo: '150101',
  esPrincipal: true,
};
const NORTE: SedeTienda = {
  id: 2,
  nombre: 'Norte',
  direccion: 'Av. Túpac 500',
  ubigeo: '150110',
  esPrincipal: false,
};
const SUR: SedeTienda = {
  id: 3,
  nombre: 'Sur',
  direccion: null,
  ubigeo: null,
  esPrincipal: false,
};
const ACTIVAS = [CENTRO, NORTE, SUR];

/** Prisma mínimo para cargarStockPorSede. */
function prismaStock(opts: {
  productos: Array<{
    id: number;
    stock: number;
    porcentajeProvision?: number;
    atributosTecnicos?: any;
  }>;
  filas?: Array<{
    productoId: number;
    sedeId: number;
    stock: number;
    visibleEnSede?: boolean;
    vendibleEnSede?: boolean;
  }>;
  reservas?: Array<{ productoId: number; sedeId: number; cantidad: number }>;
}) {
  return {
    producto: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            opts.productos
              .filter((p) => where.id.in.includes(p.id))
              .map((p) => ({
                porcentajeProvision: 0,
                atributosTecnicos: {},
                ...p,
              })),
          ),
        ),
    },
    productoStock: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            (opts.filas ?? [])
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
    sede: { findMany: jest.fn().mockResolvedValue(ACTIVAS) },
    ubigeo: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            codigo: '150101',
            distrito: 'LIMA',
            provincia: 'LIMA',
            departamento: 'LIMA',
          },
        ]),
    },
  } as any;
}

describe('regla común de stock disponible', () => {
  it('stock − reservas, sin pasar la provisión, nunca negativo', () => {
    expect(
      disponibleParaVenta({
        stockBase: 10,
        reservado: 0,
        porcentajeProvision: 0,
      }),
    ).toBe(10);
    expect(
      disponibleParaVenta({
        stockBase: 10,
        reservado: 3,
        porcentajeProvision: 0,
      }),
    ).toBe(7);
    // 20 % de 10 = 2 de provisión → cupo 8; con 1 reservado manda la provisión.
    expect(
      disponibleParaVenta({
        stockBase: 10,
        reservado: 1,
        porcentajeProvision: 20,
      }),
    ).toBe(8);
    expect(
      disponibleParaVenta({
        stockBase: 10,
        reservado: 4,
        porcentajeProvision: 20,
      }),
    ).toBe(6);
    expect(disponibleParaVenta({ stockBase: -3, reservado: 0 })).toBe(0);
    expect(disponibleParaVenta({ stockBase: 2, reservado: 5 })).toBe(0);
  });
});

describe('cargarStockPorSede', () => {
  it('varias sedes: sin fila en la sede vale 0 (no la suma global)', async () => {
    const prisma = prismaStock({
      productos: [{ id: 7, stock: 50 }],
      filas: [{ productoId: 7, sedeId: 1, stock: 50 }],
    });
    const m = await cargarStockPorSede(prisma, {
      empresaId: 9,
      productoIds: [7],
      sedeIds: [1, 2],
      sinFilaUsaStockGlobal: false,
    });
    expect(m.get(7)!.porSede.get(1)!.disponible).toBe(50);
    expect(m.get(7)!.porSede.get(2)).toMatchObject({
      tieneFila: false,
      disponible: 0,
      visible: true,
      vendible: true,
    });
  });

  it('una sola sede: sin fila usa Producto.stock (datos antiguos)', async () => {
    const prisma = prismaStock({ productos: [{ id: 7, stock: 12 }] });
    const m = await cargarStockPorSede(prisma, {
      empresaId: 9,
      productoIds: [7],
      sedeIds: [1],
      sinFilaUsaStockGlobal: true,
    });
    expect(m.get(7)!.porSede.get(1)!.disponible).toBe(12);
  });

  it('descuenta reservas activas y provisión de ESA sede', async () => {
    const prisma = prismaStock({
      productos: [{ id: 7, stock: 30, porcentajeProvision: 10 }],
      filas: [
        { productoId: 7, sedeId: 1, stock: 20 },
        { productoId: 7, sedeId: 2, stock: 10 },
      ],
      reservas: [{ productoId: 7, sedeId: 1, cantidad: 5 }],
    });
    const m = await cargarStockPorSede(prisma, {
      empresaId: 9,
      productoIds: [7],
      sedeIds: [1, 2],
      sinFilaUsaStockGlobal: false,
    });
    expect(m.get(7)!.porSede.get(1)!.disponible).toBe(15); // 20 − 5 (provisión 2 no manda)
    expect(m.get(7)!.porSede.get(2)!.disponible).toBe(9); // 10 − 10 % = 9
    // Reservas solo de estados activos.
    expect(prisma.reserva.groupBy.mock.calls[0][0].where.estado).toEqual({
      in: ['PENDIENTE', 'CONFIRMADA'],
    });
  });

  it('visible/vendible por sede', async () => {
    const prisma = prismaStock({
      productos: [{ id: 7, stock: 8 }],
      filas: [
        { productoId: 7, sedeId: 1, stock: 4, visibleEnSede: false },
        { productoId: 7, sedeId: 2, stock: 4, vendibleEnSede: false },
      ],
    });
    const m = await cargarStockPorSede(prisma, {
      empresaId: 9,
      productoIds: [7],
      sedeIds: [1, 2],
      sinFilaUsaStockGlobal: false,
    });
    expect(m.get(7)!.porSede.get(1)).toMatchObject({
      visible: false,
      vendible: false,
    });
    expect(m.get(7)!.porSede.get(2)).toMatchObject({
      visible: true,
      vendible: false,
    });
  });

  it('sin ids no consulta nada', async () => {
    const prisma = prismaStock({ productos: [] });
    const m = await cargarStockPorSede(prisma, {
      empresaId: 9,
      productoIds: [],
      sedeIds: [1],
      sinFilaUsaStockGlobal: false,
    });
    expect(m.size).toBe(0);
    expect(prisma.producto.findMany).not.toHaveBeenCalled();
  });
});

describe('resolverContextoStock', () => {
  it('SEDE: la configurada; null o inactiva = la principal; ?sede se ignora', () => {
    expect(
      resolverContextoStock(
        9,
        { tiendaStockModo: 'SEDE', tiendaSedeId: 2 },
        ACTIVAS,
        3,
      ).sede?.id,
    ).toBe(2);
    expect(
      resolverContextoStock(
        9,
        { tiendaStockModo: 'SEDE', tiendaSedeId: null },
        ACTIVAS,
      ).sede?.id,
    ).toBe(1);
    expect(
      resolverContextoStock(
        9,
        { tiendaStockModo: 'SEDE', tiendaSedeId: 99 },
        ACTIVAS,
      ).sede?.id,
    ).toBe(1);
    const ctx = resolverContextoStock(
      9,
      { tiendaStockModo: 'SEDE', tiendaSedeId: 2 },
      ACTIVAS,
      3,
      { estricto: true },
    );
    expect(ctx.sedeIds).toEqual([2]);
  });

  it('CLIENTE: ofrece tiendaSedesIds (vacío = todas) y usa la elegida', () => {
    const ctx = resolverContextoStock(
      9,
      { tiendaStockModo: 'CLIENTE', tiendaSedesIds: [2, 3] },
      ACTIVAS,
      '3',
    );
    expect(ctx.sedesHabilitadas.map((s) => s.id)).toEqual([2, 3]);
    expect(ctx.sede?.id).toBe(3);
    expect(ctx.sedeDefaultId).toBe(2); // la principal no está habilitada → la primera
    expect(
      resolverContextoStock(
        9,
        { tiendaStockModo: 'CLIENTE', tiendaSedesIds: [] },
        ACTIVAS,
      ).sedesHabilitadas,
    ).toHaveLength(3);
  });

  it('CLIENTE lectura: sede no habilitada o basura cae a la de por defecto', () => {
    const cfg = { tiendaStockModo: 'CLIENTE' as const, tiendaSedesIds: [1, 2] };
    expect(resolverContextoStock(9, cfg, ACTIVAS, 3).sede?.id).toBe(1);
    expect(resolverContextoStock(9, cfg, ACTIVAS, 'abc').sede?.id).toBe(1);
  });

  it('CLIENTE estricto (pedido): sin sede → 400; no habilitada → 400', () => {
    const cfg = { tiendaStockModo: 'CLIENTE' as const, tiendaSedesIds: [1, 2] };
    expect(() =>
      resolverContextoStock(9, cfg, ACTIVAS, undefined, { estricto: true }),
    ).toThrow(MENSAJES_STOCK_TIENDA.elegirSede);
    expect(() =>
      resolverContextoStock(9, cfg, ACTIVAS, 3, { estricto: true }),
    ).toThrow(MENSAJES_STOCK_TIENDA.sedeNoHabilitada);
    expect(() =>
      resolverContextoStock(9, cfg, ACTIVAS, 'x', { estricto: true }),
    ).toThrow(BadRequestException);
  });

  it('CLIENTE con una sola sede habilitada: no exige elegir', () => {
    const ctx = resolverContextoStock(
      9,
      { tiendaStockModo: 'CLIENTE', tiendaSedesIds: [2] },
      ACTIVAS,
      undefined,
      { estricto: true },
    );
    expect(ctx.sede?.id).toBe(2);
  });

  it('TODAS: suma las habilitadas y no tiene sede', () => {
    const ctx = resolverContextoStock(
      9,
      { tiendaStockModo: 'TODAS', tiendaSedesIds: [1, 3, 77] },
      ACTIVAS,
      2,
    );
    expect(ctx.sede).toBeNull();
    expect(ctx.sedeIds).toEqual([1, 3]);
    expect(ctx.sinFilaUsaStockGlobal).toBe(false);
  });

  it('sin sedes activas: modo legado con Producto.stock', () => {
    const ctx = resolverContextoStock(
      9,
      { tiendaStockModo: 'CLIENTE' },
      [],
      1,
      { estricto: true },
    );
    expect(ctx).toMatchObject({ sinSedes: true, sede: null, sedeIds: [] });
  });

  it('modo desconocido = SEDE', () => {
    expect(
      resolverContextoStock(9, { tiendaStockModo: 'OTRO' as any }, ACTIVAS)
        .modo,
    ).toBe('SEDE');
  });
});

describe('stock de la tienda por producto', () => {
  const producto = (
    porSede: Array<
      [
        number,
        Partial<{ disponible: number; visible: boolean; vendible: boolean }>,
      ]
    >,
    extra: any = {},
  ) => ({
    id: 7,
    stockGlobal: 99,
    porcentajeProvision: 0,
    esServicio: false,
    porSede: new Map(
      porSede.map(([sedeId, v]) => [
        sedeId,
        {
          sedeId,
          tieneFila: true,
          stockBase: v.disponible ?? 0,
          reservado: 0,
          disponible: v.disponible ?? 0,
          visible: v.visible ?? true,
          vendible: v.vendible ?? true,
        },
      ]),
    ),
    ...extra,
  });

  it('TODAS suma solo lo vendible de cada sede', () => {
    const ctx = resolverContextoStock(9, { tiendaStockModo: 'TODAS' }, ACTIVAS);
    const p = producto([
      [1, { disponible: 4 }],
      [2, { disponible: 6, vendible: false }],
      [3, { disponible: 1 }],
    ]);
    expect(stockTiendaDe(ctx, p)).toEqual({
      stock: 5,
      vendible: true,
      visible: true,
    });
  });

  it('SEDE: no vendible en la sede = stock 0 y no vendible', () => {
    const ctx = resolverContextoStock(
      9,
      { tiendaStockModo: 'SEDE', tiendaSedeId: 2 },
      ACTIVAS,
    );
    expect(
      stockTiendaDe(ctx, producto([[2, { disponible: 6, vendible: false }]])),
    ).toEqual({ stock: 0, vendible: false, visible: true });
  });

  it('servicio: conserva su stock de siempre', () => {
    const ctx = resolverContextoStock(9, { tiendaStockModo: 'SEDE' }, ACTIVAS);
    expect(
      stockTiendaDe(
        ctx,
        producto([[1, { disponible: 0 }]], { esServicio: true }),
      ).stock,
    ).toBe(99);
  });

  it('CLIENTE: "Disponible en" lista las otras sedes con stock vendible', () => {
    const ctx = resolverContextoStock(
      9,
      { tiendaStockModo: 'CLIENTE' },
      ACTIVAS,
      1,
    );
    const p = producto([
      [1, { disponible: 0 }],
      [2, { disponible: 3 }],
      [3, { disponible: 5, vendible: false }],
    ]);
    expect(disponibleEnOtrasSedes(ctx, p)).toEqual([
      { sedeId: 2, nombre: 'Norte', stock: 3 },
    ]);
    const enSede = resolverContextoStock(
      9,
      { tiendaStockModo: 'SEDE' },
      ACTIVAS,
    );
    expect(disponibleEnOtrasSedes(enSede, p)).toEqual([]);
  });

  it('combo: mínimo de componentes ÷ cantidad; un componente no vendible lo bloquea', () => {
    const ctx = resolverContextoStock(9, { tiendaStockModo: 'SEDE' }, ACTIVAS);
    const mapa = new Map<number, any>([
      [7, { ...producto([[1, { disponible: 9 }]]), id: 7 }],
      [8, { ...producto([[1, { disponible: 4 }]]), id: 8 }],
    ]);
    expect(
      stockDeCombo(
        ctx,
        [
          { productoId: 7, cantidad: 2 },
          { productoId: 8, cantidad: 1 },
        ],
        mapa,
      ),
    ).toMatchObject({ stock: 4, vendible: true });
    mapa.set(8, {
      ...producto([[1, { disponible: 4, vendible: false }]]),
      id: 8,
    });
    expect(
      stockDeCombo(
        ctx,
        [
          { productoId: 7, cantidad: 2 },
          { productoId: 8, cantidad: 1 },
        ],
        mapa,
      ).vendible,
    ).toBe(false);
    expect(stockDeCombo(ctx, [], mapa)).toMatchObject({
      stock: 0,
      vendible: false,
    });
  });

  it('mensaje 409 nombra las dos sedes', () => {
    expect(mensajeSedeDistinta('Norte', 'Centro')).toBe(
      'Este pedido es de la sede Norte y el comprobante salió de Centro. Emítelo desde Norte o genera la nota desde el pedido.',
    );
  });
});

describe('StockTienda (con Prisma)', () => {
  it('filtro del catálogo, una sede: oculto en la sede fuera y stock global ≥ 0 (como antes)', async () => {
    const prisma = prismaStock({ productos: [] });
    prisma.sede.findMany.mockResolvedValue([CENTRO]);
    const st = new StockTienda(prisma);
    const ctx = await st.contexto({ id: 9, tiendaStockModo: 'SEDE' });
    expect(await st.filtroCatalogo(ctx)).toEqual({
      AND: [
        { NOT: { stocks: { some: { sedeId: 1, visibleEnSede: false } } } },
        { stock: { gte: 0 } },
      ],
    });
    expect(prisma.productoStock.groupBy).not.toHaveBeenCalled();
  });

  it('filtro del catálogo, TODAS con varias sedes: oculto en todas, y suma negativa fuera', async () => {
    const prisma = prismaStock({ productos: [] });
    prisma.productoStock.groupBy.mockResolvedValue([{ productoId: 44 }]);
    const st = new StockTienda(prisma);
    const ctx = await st.contexto({
      id: 9,
      tiendaStockModo: 'TODAS',
      tiendaSedesIds: [1, 2],
    });
    const filtro: any = await st.filtroCatalogo(ctx);
    expect(filtro.AND[0]).toEqual({
      NOT: {
        AND: [
          { stocks: { some: { sedeId: 1, visibleEnSede: false } } },
          { stocks: { some: { sedeId: 2, visibleEnSede: false } } },
        ],
      },
    });
    expect(filtro.AND[1]).toEqual({ id: { notIn: [44] } });
    const args = prisma.productoStock.groupBy.mock.calls[0][0];
    expect(args.where).toEqual({
      sedeId: { in: [1, 2] },
      producto: { empresaId: 9 },
    });
    expect(args.having).toEqual({ stock: { _sum: { lt: 0 } } });
  });

  it('sin sedes: el filtro de siempre', async () => {
    const prisma = prismaStock({ productos: [] });
    prisma.sede.findMany.mockResolvedValue([]);
    const st = new StockTienda(prisma);
    expect(await st.filtroCatalogo(await st.contexto({ id: 9 }))).toEqual({
      stock: { gte: 0 },
    });
  });

  it('aplicar: reemplaza stock del producto y de sus variantes y agrega vendible', async () => {
    const prisma = prismaStock({
      productos: [
        { id: 7, stock: 30 },
        { id: 70, stock: 30 },
      ],
      filas: [
        { productoId: 7, sedeId: 2, stock: 3 },
        { productoId: 70, sedeId: 2, stock: 8, vendibleEnSede: false },
        { productoId: 7, sedeId: 1, stock: 27 },
      ],
    });
    const st = new StockTienda(prisma);
    const ctx = await st.contexto({ id: 9, tiendaStockModo: 'CLIENTE' }, 2);
    const [p] = await st.aplicar(
      ctx,
      [{ id: 7, stock: '30', variantes: [{ id: 70, stock: '30' }] }],
      { conDisponibleEn: true },
    );
    expect(p).toMatchObject({
      stock: 3,
      vendible: true,
      disponibleEn: [{ sedeId: 1, nombre: 'Centro', stock: 27 }],
    });
    expect((p as any).variantes[0]).toMatchObject({
      id: 70,
      stock: 0,
      vendible: false,
      disponibleEn: [],
    });
  });

  it('sedes públicas con distrito del ubigeo', async () => {
    const st = new StockTienda(prismaStock({ productos: [] }));
    const ctx = await st.contexto({
      id: 9,
      tiendaStockModo: 'CLIENTE',
      tiendaSedesIds: [1, 3],
    });
    expect(await st.sedesPublicas(ctx)).toEqual([
      {
        id: 1,
        nombre: 'Centro',
        direccion: 'Jr. Lima 100',
        distrito: 'LIMA',
        provincia: 'LIMA',
        departamento: 'LIMA',
        esPrincipal: true,
      },
      {
        id: 3,
        nombre: 'Sur',
        direccion: null,
        distrito: null,
        provincia: null,
        departamento: null,
        esPrincipal: false,
      },
    ]);
  });
});
