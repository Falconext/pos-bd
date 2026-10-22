/**
 * Recompra por producto (2026-10-21). Antes el aviso salía a los 25 días para
 * todo, y como la clave era solo el producto, el cliente que compraba lo
 * mismo cada mes lo recibía una sola vez en la vida.
 */
import { elegirRecompra, TipoDisparo } from './leads-disparadores';
import { LeadsDisparadoresService } from './leads-disparadores.service';

describe('de qué producto y a los cuántos días', () => {
  it('va el que se acaba primero', () => {
    const r = elegirRecompra(
      [1, 2, 3],
      [
        { id: 1, diasRecompra: 60 },
        { id: 2, diasRecompra: 30 },
        { id: 3, diasRecompra: null },
      ],
      25,
    );
    expect(r).toEqual({ productoId: 3, dias: 25 });
  });

  it('sin días propios usa lo de la empresa; la variante, lo de su padre', () => {
    expect(elegirRecompra([1], [{ id: 1, diasRecompra: null }], 40)).toEqual({ productoId: 1, dias: 40 });
    expect(
      elegirRecompra([7], [{ id: 7, diasRecompra: null, diasRecompraPadre: 15 }], 25),
    ).toEqual({ productoId: 7, dias: 15 });
  });

  it('lo que no se recompra (0) no cuenta; si es todo así, no hay aviso', () => {
    expect(
      elegirRecompra([1, 2], [{ id: 1, diasRecompra: 0 }, { id: 2, diasRecompra: 45 }], 25),
    ).toEqual({ productoId: 2, dias: 45 });
    expect(elegirRecompra([1], [{ id: 1, diasRecompra: 0 }], 25)).toBeNull();
    expect(elegirRecompra([1], [{ id: 1, diasRecompra: null, diasRecompraPadre: 0 }], 25)).toBeNull();
  });

  it('en empate, el primero del pedido', () => {
    expect(
      elegirRecompra([2, 1], [{ id: 1, diasRecompra: 30 }, { id: 2, diasRecompra: 30 }], 25),
    ).toEqual({ productoId: 2, dias: 30 });
  });
});

describe('al entregarse el pedido', () => {
  const ENTREGA = new Date('2026-10-01T15:00:00Z'); // 10:00 en Lima

  function armar(productos: any[], config: any = {}) {
    const prisma: any = {
      leadPedidoBorrador: {
        findMany: jest.fn().mockResolvedValue([
          {
            empresaId: 89,
            conversacionId: 5,
            comprobanteId: 829,
            itemsJson: productos.map((p) => ({ productoId: p.id })),
            conversacion: { telefonoProspecto: '51987654321' },
          },
        ]),
      },
      envioDespacho: {
        findMany: jest.fn().mockResolvedValue([{ comprobanteId: 829, estado: 'ENTREGADO', entregadoEn: ENTREGA }]),
      },
      leadProspecto: { findFirst: jest.fn().mockResolvedValue(null) },
      producto: { findMany: jest.fn().mockResolvedValue(productos) },
      empresa: { findUnique: jest.fn().mockResolvedValue({ iaVentasConfigJson: { disparadores: config } }) },
      usuario: { findMany: jest.fn().mockResolvedValue([]) },
      leadDisparo: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const servicio = new LeadsDisparadoresService(prisma, {} as any, { mover: jest.fn() } as any);
    return { servicio, prisma };
  }
  const recompras = (prisma: any) =>
    prisma.leadDisparo.upsert.mock.calls
      .map((c: any) => c[0].create)
      .filter((c: any) => c.tipo === TipoDisparo.RECOMPRA);

  it('programa a los días del producto, con la compra en la referencia', async () => {
    const { servicio, prisma } = armar([
      { id: 12, diasRecompra: 30, productoPadre: null },
      { id: 13, diasRecompra: 90, productoPadre: null },
    ]);
    await servicio.reconciliarConDespachos();
    const [r] = recompras(prisma);
    expect(r.referencia).toBe('producto:12:comprobante:829');
    expect(r.programadoPara.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });

  it('sin días en el producto, respeta la demora que configuró la empresa', async () => {
    const { servicio, prisma } = armar([{ id: 12, diasRecompra: null, productoPadre: null }], {
      demorasHoras: { [TipoDisparo.RECOMPRA]: 40 * 24 },
    });
    await servicio.reconciliarConDespachos();
    expect(recompras(prisma)[0].programadoPara.toISOString()).toBe('2026-11-10T15:00:00.000Z');
  });

  it('el aviso de una compra anterior que todavía no salió se cancela', async () => {
    const { servicio, prisma } = armar([{ id: 12, diasRecompra: 30, productoPadre: null }]);
    await servicio.reconciliarConDespachos();
    expect(prisma.leadDisparo.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        empresaId: 89,
        telefono: '51987654321',
        tipo: TipoDisparo.RECOMPRA,
        estado: 'PROGRAMADO',
        referencia: { not: 'producto:12:comprobante:829' },
      }),
      data: expect.objectContaining({ estado: 'CANCELADO' }),
    });
  });

  it('un pedido de cosas que no se recompran no programa nada', async () => {
    const { servicio, prisma } = armar([{ id: 12, diasRecompra: 0, productoPadre: null }]);
    await servicio.reconciliarConDespachos();
    expect(recompras(prisma)).toHaveLength(0);
    expect(prisma.leadDisparo.updateMany).not.toHaveBeenCalled();
  });
});

describe('al enviar', () => {
  it('lee el producto de la referencia nueva y de la vieja', () => {
    const s: any = Object.create(LeadsDisparadoresService.prototype);
    expect(s.idDeReferencia('producto:12:comprobante:829', 'producto')).toBe(12);
    expect(s.idDeReferencia('producto:12:comprobante:829', 'comprobante')).toBe(829);
    expect(s.idDeReferencia('producto:12', 'producto')).toBe(12);
    expect(s.idDeReferencia('comprobante:829', 'producto')).toBeNull();
    expect(s.idDeReferencia('inactivo:2026-10', 'producto')).toBeNull();
  });
});

describe('al guardar el producto', () => {
  // El PUT de productos no pasa el body por el DTO: 400 y -1 se guardaban.
  it('acepta 0 a 365 o vacío, y rechaza lo demás', () => {
    const { diasRecompraValido } = require('../producto/producto.service');
    expect(diasRecompraValido(undefined)).toBeUndefined();
    expect(diasRecompraValido(null)).toBeNull();
    expect(diasRecompraValido('')).toBeNull();
    expect(diasRecompraValido(0)).toBe(0);
    expect(diasRecompraValido('30')).toBe(30);
    for (const malo of [400, -1, 2.5, 'abc']) {
      expect(() => diasRecompraValido(malo)).toThrow('van de 1 a 365');
    }
  });
});
