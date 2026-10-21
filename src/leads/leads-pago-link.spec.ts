/**
 * Cobrar por link de Mercado Pago desde el chat (21-10).
 *
 * Lo que se defiende:
 *   1. que solo cobre quien lo activó y tiene su Mercado Pago conectado;
 *   2. que el monto salga de lo cotizado, no de lo que diga el modelo;
 *   3. que el pago confirmado entre como un voucher ya validado, una sola vez
 *      aunque Mercado Pago reintente, y solo si entró a la cuenta del negocio;
 *   4. que el bot se entere y siga con el pedido.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsPagoLinkService } from './leads-pago-link.service';
import { medioDePago } from './leads-embudo.service';

const EMPRESA = 22;
const CONV = 300;

function armar(opts: {
  cobroConLink?: boolean;
  conectada?: boolean;
  cuenta?: any;
  mpUserId?: string | null;
  yaRegistrado?: number;
  comprobanteId?: number | null;
  mensajeDuplicado?: boolean;
  registro?: any;
} = {}) {
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        iaVentasConfigJson: { cobroConLink: opts.cobroConLink ?? true },
        nombreComercial: 'KREZKA',
        razonSocial: 'KREZKA SAC',
        mpUserId: opts.mpUserId === undefined ? '999' : opts.mpUserId,
      }),
    },
    leadConversacion: {
      findUnique: jest.fn().mockResolvedValue({ id: CONV, empresaId: EMPRESA, telefonoProspecto: '51987654321' }),
    },
    leadComprobantePago: { count: jest.fn().mockResolvedValue(opts.yaRegistrado ?? 0) },
    leadPedidoBorrador: {
      findUnique: jest.fn().mockResolvedValue({ comprobanteId: opts.comprobanteId ?? null }),
    },
    leadMensaje: {
      create: opts.mensajeDuplicado
        ? jest.fn().mockRejectedValue(new Error('Unique constraint'))
        : jest.fn().mockResolvedValue({ id: 1 }),
    },
  };
  const mp: any = {
    registrarReceptor: jest.fn(),
    estaConectada: jest.fn().mockResolvedValue(opts.conectada ?? true),
    crearCobro: jest.fn().mockResolvedValue({ preferenceId: 'pref', initPoint: 'https://mpago.la/abc' }),
  };
  const pedido: any = {
    porPagarDelPedido: jest.fn().mockResolvedValue(opts.cuenta ?? { total: 60, pagado: 0, porPagar: 60 }),
  };
  const embudo: any = {
    registrarComprobantePago: jest.fn().mockResolvedValue(opts.registro ?? { registrado: true, pago: { id: 77 } }),
    validarPago: jest.fn().mockResolvedValue({ validado: true }),
  };
  const notificaciones: any = { notificarAdminsEmpresa: jest.fn().mockResolvedValue(undefined) };
  const queue: any = { add: jest.fn().mockResolvedValue(undefined) };
  const servicio = new LeadsPagoLinkService(prisma, mp, pedido, embudo, notificaciones, queue);
  return { servicio, prisma, mp, pedido, embudo, notificaciones, queue };
}

const PAGO = {
  id: 123456789,
  status: 'approved',
  external_reference: `lead-${CONV}-1729500000000`,
  transaction_amount: 60,
  collector_id: 999,
  date_approved: '2026-10-21T15:00:00.000-05:00',
  payer: { first_name: 'Diego', last_name: 'Ortega' },
};

describe('generar el link', () => {
  it('cobra lo que falta de lo cotizado, a nombre del negocio', async () => {
    const { servicio, mp } = armar();
    const r = await servicio.generarLink(EMPRESA, CONV);
    expect(r).toMatchObject({ link: 'https://mpago.la/abc', monto: 60, esTotal: true });
    const cobro = mp.crearCobro.mock.calls[0][0];
    expect(cobro).toMatchObject({ empresaId: EMPRESA, total: 60, titulo: 'Pedido KREZKA' });
    expect(cobro.referencia).toMatch(new RegExp(`^lead-${CONV}-\\d+$`));
    expect(r.instruccion).toMatch(/NO le digas que su pago está confirmado/);
  });

  it('una reserva o adelanto: cobra ese monto', async () => {
    const { servicio, mp } = armar();
    const r = await servicio.generarLink(EMPRESA, CONV, 30);
    expect(r).toMatchObject({ monto: 30, esTotal: false });
    expect(mp.crearCobro.mock.calls[0][0].total).toBe(30);
  });

  describe('lo que NO debe pasar', () => {
    it('el negocio no lo activó: no se crea nada', async () => {
      const { servicio, mp } = armar({ cobroConLink: false });
      expect(await servicio.generarLink(EMPRESA, CONV)).toHaveProperty('noDisponible');
      expect(mp.crearCobro).not.toHaveBeenCalled();
    });

    it('lo activó pero desconectó su Mercado Pago', async () => {
      const { servicio, mp } = armar({ conectada: false });
      expect(await servicio.generarLink(EMPRESA, CONV)).toHaveProperty('noDisponible');
      expect(mp.crearCobro).not.toHaveBeenCalled();
    });

    it('sin cotización no hay link', async () => {
      const { servicio, mp } = armar({ cuenta: { error: 'Todavía no hay nada cotizado' } });
      expect(await servicio.generarLink(EMPRESA, CONV)).toEqual({ error: 'Todavía no hay nada cotizado' });
      expect(mp.crearCobro).not.toHaveBeenCalled();
    });

    it('el modelo no puede cobrar más de lo que falta', async () => {
      const { servicio, mp } = armar({ cuenta: { total: 60, pagado: 20, porPagar: 40 } });
      const r = await servicio.generarLink(EMPRESA, CONV, 60);
      expect(r.error).toMatch(/mayor a lo que falta pagar \(S\/ 40\.00\)/);
      expect(mp.crearCobro).not.toHaveBeenCalled();
    });

    it('ya pagó todo', async () => {
      const { servicio } = armar({ cuenta: { total: 60, pagado: 60, porPagar: 0 } });
      expect((await servicio.generarLink(EMPRESA, CONV)).error).toMatch(/ya pagó todo/);
    });

    it('menos de S/ 5: Mercado Pago lo rechaza, se pide por Yape', async () => {
      const { servicio, mp } = armar();
      expect((await servicio.generarLink(EMPRESA, CONV, 4)).error).toMatch(/menores a S\/ 5/);
      expect(mp.crearCobro).not.toHaveBeenCalled();
    });

    it('si Mercado Pago falla, se pide por los otros medios', async () => {
      const { servicio, mp } = armar();
      mp.crearCobro.mockRejectedValue(new Error('500'));
      expect((await servicio.generarLink(EMPRESA, CONV)).error).toMatch(/Yape o transferencia/);
    });
  });
});

describe('el pago confirmado', () => {
  it('se registra en el módulo de Mercado Pago al arrancar', () => {
    const { servicio, mp } = armar();
    servicio.onModuleInit();
    expect(mp.registrarReceptor).toHaveBeenCalledWith('lead-', expect.any(Function));
  });

  it('entra como comprobante leído, ya validado', async () => {
    const { servicio, embudo } = armar();
    await servicio.pagoRecibido(PAGO);
    expect(embudo.registrarComprobantePago).toHaveBeenCalledWith(EMPRESA, CONV, {
      nota: 'Pagado con el link de Mercado Pago',
      leido: {
        monto: 60,
        numeroOperacion: '123456789',
        fecha: PAGO.date_approved,
        medio: 'Mercado Pago',
        pagador: 'Diego Ortega',
      },
    });
    // Sin pedido registrado todavía: no pasa a despacho.
    expect(embudo.validarPago).toHaveBeenCalledWith(77, EMPRESA, { nombre: 'Mercado Pago' }, false);
  });

  it('con el pedido ya registrado, pasa a despacho', async () => {
    const { servicio, embudo } = armar({ comprobanteId: 500 });
    await servicio.pagoRecibido(PAGO);
    expect(embudo.validarPago).toHaveBeenCalledWith(77, EMPRESA, { nombre: 'Mercado Pago' }, true);
  });

  it('el bot se entera y responde', async () => {
    const { servicio, prisma, queue, notificaciones } = armar();
    await servicio.pagoRecibido(PAGO);
    const msg = prisma.leadMensaje.create.mock.calls[0][0].data;
    expect(msg).toMatchObject({ conversacionId: CONV, rol: 'USUARIO', whatsappMsgId: 'mp-123456789' });
    expect(msg.contenido).toMatch(/Mercado Pago confirmó que el cliente pagó S\/ 60\.00/);
    expect(queue.add).toHaveBeenCalledWith(
      'responder',
      { empresaId: EMPRESA, conversacionId: CONV },
      expect.objectContaining({ jobId: `resp-${EMPRESA}-${CONV}-mp-123456789` }),
    );
    expect(notificaciones.notificarAdminsEmpresa.mock.calls[0][0].titulo).toMatch(/S\/ 60\.00/);
  });

  describe('lo que NO debe pasar', () => {
    it('un pago pendiente o rechazado no registra nada', async () => {
      const { servicio, embudo, queue } = armar();
      await servicio.pagoRecibido({ ...PAGO, status: 'pending' });
      await servicio.pagoRecibido({ ...PAGO, status: 'rejected' });
      expect(embudo.registrarComprobantePago).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('un pago cobrado por OTRA cuenta no cuenta para este negocio', async () => {
      const { servicio, embudo } = armar();
      await servicio.pagoRecibido({ ...PAGO, collector_id: 111 });
      expect(embudo.registrarComprobantePago).not.toHaveBeenCalled();
    });

    it('Mercado Pago reintenta: el mismo pago no se registra dos veces', async () => {
      const { servicio, embudo, queue } = armar({ yaRegistrado: 1 });
      await servicio.pagoRecibido(PAGO);
      expect(embudo.registrarComprobantePago).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('si el aviso al bot ya existía, no se responde otra vez', async () => {
      const { servicio, queue } = armar({ mensajeDuplicado: true });
      await servicio.pagoRecibido(PAGO);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('una referencia que no es del chat se ignora', async () => {
      const { servicio, embudo } = armar();
      await servicio.pagoRecibido({ ...PAGO, external_reference: 'TND-ABC123' });
      expect(embudo.registrarComprobantePago).not.toHaveBeenCalled();
    });
  });
});

it('en caja el pago entra como MERCADO_PAGO, igual que en la tienda', () => {
  expect(medioDePago('Mercado Pago')).toBe('MERCADO_PAGO');
  expect(medioDePago('Yape')).toBe('YAPE');
});

describe('el webhook de Mercado Pago', () => {
  it('un pago del chat va al chat y no toca los pedidos de la tienda', async () => {
    const { MercadoPagoService } = require('../mercadopago/mercadopago.service');
    const prisma: any = { pedidoTienda: { findUnique: jest.fn() } };
    const mp = new MercadoPagoService(prisma, {} as never, {} as never);
    const receptor = jest.fn().mockResolvedValue(undefined);
    mp.registrarReceptor('lead-', receptor);
    await (mp as any).aplicarPago(PAGO, 'webhook');
    expect(receptor).toHaveBeenCalledWith(PAGO);
    expect(prisma.pedidoTienda.findUnique).not.toHaveBeenCalled();
  });

  it('un pago de la tienda sigue yendo a la tienda', async () => {
    const { MercadoPagoService } = require('../mercadopago/mercadopago.service');
    const prisma: any = { pedidoTienda: { findUnique: jest.fn().mockResolvedValue(null) } };
    const mp = new MercadoPagoService(prisma, {} as never, {} as never);
    const receptor = jest.fn();
    mp.registrarReceptor('lead-', receptor);
    await (mp as any).aplicarPago({ ...PAGO, external_reference: 'TND-ABC' }, 'webhook');
    expect(receptor).not.toHaveBeenCalled();
    expect(prisma.pedidoTienda.findUnique).toHaveBeenCalled();
  });
});

describe('cuánto falta pagar', () => {
  const { LeadsPedidoService } = require('./leads-pedido.service');
  function pedido(borrador: any, extra: any = {}) {
    const prisma: any = {
      empresa: { findUnique: jest.fn().mockResolvedValue({ iaVentasConfigJson: {} }) },
      leadPedidoBorrador: { findUnique: jest.fn().mockResolvedValue(borrador) },
      producto: { findMany: jest.fn().mockResolvedValue([{ id: 1, precioUnitario: 25 }]) },
      leadComprobantePago: { findMany: jest.fn().mockResolvedValue(extra.pagos ?? []) },
      comprobante: { findUnique: jest.fn().mockResolvedValue(extra.nota ?? null) },
      envioDespacho: { findUnique: jest.fn().mockResolvedValue(extra.despacho ?? null) },
    };
    return new LeadsPedidoService(prisma, {} as never, {} as never, {} as never);
  }
  const cotizado = { itemsJson: [{ productoId: 1, cantidad: 2 }], costoEnvio: 10, cotizadoEn: new Date(), comprobanteId: null };

  it('lo cotizado (precio de hoy + envío) menos lo ya pagado', async () => {
    const r = await pedido(cotizado, { pagos: [{ montoLeido: 20, medioLeido: 'Yape' }] }).porPagarDelPedido(EMPRESA, CONV);
    expect(r).toEqual({ total: 60, pagado: 20, porPagar: 40 });
  });

  it('sin cotización, lo dice', async () => {
    const r = await pedido({ ...cotizado, cotizadoEn: null }).porPagarDelPedido(EMPRESA, CONV);
    expect(r.error).toMatch(/Cotiza primero/);
  });

  it('pedido registrado: lo que cobraría el despacho', async () => {
    const r = await pedido(
      { ...cotizado, comprobanteId: 9 },
      { nota: { saldo: 50, estadoPago: 'PENDIENTE' }, despacho: { montoCOD: 35 } },
    ).porPagarDelPedido(EMPRESA, CONV);
    expect(r).toEqual({ total: 60, pagado: 25, porPagar: 35 });
  });
});
