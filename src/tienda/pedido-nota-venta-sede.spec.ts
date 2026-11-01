/**
 * "Generar nota" de un pedido de la tienda: de qué sede sale y qué se le pasa
 * al comprobante. Precedencia: sede del pedido → sede elegida en el panel →
 * la única sede activa → 400.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PedidoNotaVentaService } from './pedido-nota-venta.service';
import { MENSAJES_STOCK_TIENDA } from './stock-tienda';

function armar(
  opts: {
    sedePedido?: number | null;
    sedesActivas?: number[];
    sedeElegidaExiste?: boolean;
  } = {},
) {
  const pedido = {
    id: 41,
    codigoSeguimiento: 'PT-ABC',
    estado: 'PENDIENTE',
    comprobanteId: null,
    sedeId: opts.sedePedido ?? null,
    total: 100,
    costoEnvio: 0,
    tipoEntrega: 'RECOJO',
    clienteNombre: 'Ana',
    clienteDocumento: null,
    clienteTelefono: '999888777',
    clienteDireccion: null,
    envioCourier: null,
    items: [
      {
        productoId: 7,
        cantidad: 2,
        precioUnit: 50,
        subtotal: 100,
        producto: { descripcion: 'Polo' },
      },
    ],
  };
  const prisma: any = {
    pedidoTienda: { findFirst: jest.fn().mockResolvedValue(pedido) },
    sede: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            opts.sedeElegidaExiste === false ? null : { id: where.id },
          ),
        ),
      findMany: jest
        .fn()
        .mockResolvedValue((opts.sedesActivas ?? [1, 2]).map((id) => ({ id }))),
    },
    comprobante: { findUnique: jest.fn().mockResolvedValue({ id: 900 }) },
  };
  const comprobantes: any = {
    crearInformal: jest
      .fn()
      .mockResolvedValue({ id: 900, serie: 'NV01', correlativo: 1 }),
  };
  const tienda: any = { vincularComprobante: jest.fn().mockResolvedValue({}) };
  const despacho: any = { create: jest.fn() };
  const service = new PedidoNotaVentaService(
    prisma,
    comprobantes,
    despacho,
    tienda,
  );
  const sedeUsada = () => comprobantes.crearInformal.mock.calls[0][3];
  return { service, prisma, comprobantes, tienda, sedeUsada };
}

const usuario = (extra: any = {}) => ({
  rol: 'USUARIO_EMPRESA',
  sedeId: 1,
  sedesSinVenta: [],
  ...extra,
});

describe('Generar nota de un pedido · sede', () => {
  it('pedido con sede: sale de esa sede aunque el usuario esté en otra o elija otra', async () => {
    const { service, sedeUsada, comprobantes } = armar({ sedePedido: 2 });
    await service.generar(9, 41, { sedeId: 1 }, 5, usuario({ sedeId: 1 }));
    expect(sedeUsada()).toBe(2);
    // La caja que se exige es la del usuario, no la de la sede del pedido.
    expect(comprobantes.crearInformal.mock.calls[0][4]).toEqual({
      sedeCajaId: 1,
    });
    // El comprobante sabe que viene del pedido (sede y "vender sin stock").
    expect(comprobantes.crearInformal.mock.calls[0][0].pedidoTiendaId).toBe(41);
  });

  it('pedido sin sede (TODAS): usa la elegida en el panel', async () => {
    const { service, sedeUsada } = armar({ sedePedido: null });
    await service.generar(9, 41, { sedeId: '2' }, 5, usuario());
    expect(sedeUsada()).toBe(2);
  });

  it('pedido sin sede y sin elegir, empresa con una sola sede: esa', async () => {
    const { service, sedeUsada } = armar({
      sedePedido: null,
      sedesActivas: [4],
    });
    await service.generar(9, 41, {}, 5, usuario());
    expect(sedeUsada()).toBe(4);
  });

  it('pedido sin sede, varias sedes y sin elegir → 400 sin emitir', async () => {
    const { service, comprobantes } = armar({ sedePedido: null });
    await expect(service.generar(9, 41, {}, 5, usuario())).rejects.toThrow(
      MENSAJES_STOCK_TIENDA.elegirSedeNota,
    );
    expect(comprobantes.crearInformal).not.toHaveBeenCalled();
  });

  it('sede elegida inexistente, inactiva o de otra empresa → 400', async () => {
    const { service, prisma } = armar({
      sedePedido: null,
      sedeElegidaExiste: false,
    });
    await expect(
      service.generar(9, 41, { sedeId: 77 }, 5, usuario()),
    ).rejects.toThrow(MENSAJES_STOCK_TIENDA.sedeInvalida);
    expect(prisma.sede.findFirst.mock.calls[0][0].where).toEqual({
      id: 77,
      empresaId: 9,
      activo: true,
    });
    await expect(
      service.generar(9, 41, { sedeId: 'x' }, 5, usuario()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el usuario no vende en la sede de la nota → 403', async () => {
    const { service, comprobantes } = armar({ sedePedido: 2 });
    await expect(
      service.generar(9, 41, {}, 5, usuario({ sedeId: 1, sedesSinVenta: [2] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(comprobantes.crearInformal).not.toHaveBeenCalled();
  });

  it('empresa sin sedes (antigua): sigue como antes, sin sede', async () => {
    const { service, sedeUsada } = armar({
      sedePedido: null,
      sedesActivas: [],
    });
    await service.generar(9, 41, {}, 5, usuario({ sedeId: null }));
    expect(sedeUsada()).toBeUndefined();
  });
});
