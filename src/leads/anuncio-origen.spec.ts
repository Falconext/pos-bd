/**
 * De qué anuncio vino cada cliente (2026-10-21): WhatsApp ya mandaba la
 * etiqueta del anuncio en el primer mensaje y se descartaba.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import * as crypto from 'crypto';
import { origenDeAnuncio, ventasPorAnuncio } from './anuncio-origen';
import { LeadsWebhookController } from './leads-webhook.controller';
import { LeadsMessageProcessor } from './leads-message.processor';
import { LeadsBiService } from './leads-bi.service';

const REFERRAL = {
  source_url: 'https://fb.me/2ABC',
  source_id: '120211234567890',
  source_type: 'ad',
  headline: '  Zapatillas rojas 2x1  ',
  body: 'Solo esta semana',
  media_type: 'image',
  image_url: 'https://scontent.example/img.jpg',
  ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ',
};

describe('la etiqueta del anuncio', () => {
  it('se limpia y conserva el id del clic para el paso 2', () => {
    expect(origenDeAnuncio(REFERRAL)).toEqual({
      anuncioId: '120211234567890',
      tipo: 'ad',
      titulo: 'Zapatillas rojas 2x1',
      texto: 'Solo esta semana',
      url: 'https://fb.me/2ABC',
      imagenUrl: 'https://scontent.example/img.jpg',
      ctwaClid: 'ARAkLkA8rmlFeiCktEJQ',
    });
  });

  it('sin id usa el enlace; sin nada, no hay anuncio', () => {
    expect(origenDeAnuncio({ source_url: 'https://fb.me/2ABC', source_type: 'post' })?.anuncioId).toBe(
      'https://fb.me/2ABC',
    );
    expect(origenDeAnuncio({ headline: 'algo' })).toBeNull();
    expect(origenDeAnuncio(undefined)).toBeNull();
  });
});

describe('el webhook', () => {
  const SECRETO = 'secreto-de-prueba';
  const previo = process.env.META_APP_SECRET;
  beforeAll(() => (process.env.META_APP_SECRET = SECRETO));
  afterAll(() => (process.env.META_APP_SECRET = previo));

  it('pasa la etiqueta a la cola junto con el mensaje', async () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1372645942600125' },
                contacts: [{ wa_id: '51999888777', profile: { name: 'Ana' } }],
                messages: [
                  {
                    from: '51999888777',
                    id: 'wamid.AD',
                    type: 'text',
                    text: { body: 'Hola, precio?' },
                    referral: REFERRAL,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = Buffer.from(JSON.stringify(body));
    const firma = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(raw).digest('hex');
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const res: any = { status: () => res, send: jest.fn() };
    await new LeadsWebhookController(queue as never).receive(
      { headers: { 'x-hub-signature-256': firma }, body, rawBody: raw } as any,
      res,
    );
    expect(queue.add.mock.calls[0][1].referral).toEqual(REFERRAL);
  });
});

describe('al llegar el mensaje', () => {
  function procesador() {
    const prisma: any = { leadAnuncioOrigen: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const p = Object.create(LeadsMessageProcessor.prototype);
    p.prisma = prisma;
    return { p, prisma };
  }

  it('guarda de qué anuncio vino, sin duplicar si Meta lo reentrega', async () => {
    const { p, prisma } = procesador();
    await p.guardarOrigenDeAnuncio(14, 900, { messageId: 'wamid.AD', referral: REFERRAL });
    const arg = prisma.leadAnuncioOrigen.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0]).toMatchObject({
      empresaId: 14,
      conversacionId: 900,
      whatsappMsgId: 'wamid.AD',
      anuncioId: '120211234567890',
      titulo: 'Zapatillas rojas 2x1',
    });
  });

  it('un mensaje normal no guarda nada', async () => {
    const { p, prisma } = procesador();
    await p.guardarOrigenDeAnuncio(14, 900, { messageId: 'wamid.N' });
    expect(prisma.leadAnuncioOrigen.createMany).not.toHaveBeenCalled();
  });
});

describe('cuánto vendió cada anuncio', () => {
  const d = (dia: number) => new Date(`2026-10-${String(dia).padStart(2, '0')}T12:00:00-05:00`);
  const llegada = (conversacionId: number, anuncioId: string, dia: number, titulo = anuncioId) => ({
    conversacionId,
    anuncioId,
    tipo: 'ad',
    titulo,
    url: null,
    imagenUrl: null,
    creadoEn: d(dia),
  });

  it('cuenta cada conversación una vez y ordena por lo vendido', () => {
    const filas = ventasPorAnuncio(
      [llegada(1, 'rojas', 1), llegada(1, 'rojas', 2), llegada(2, 'rojas', 3), llegada(3, 'polos', 3)],
      [{ conversacionId: 2, monto: 150, fecha: d(4) }],
    );
    expect(filas.map((f) => [f.anuncioId, f.conversaciones, f.pedidos, f.vendido, f.conversion])).toEqual([
      ['rojas', 2, 1, 150, 50],
      ['polos', 1, 0, 0, 0],
    ]);
  });

  it('la venta es del último anuncio por el que llegó ANTES de comprar', () => {
    const filas = ventasPorAnuncio(
      [llegada(1, 'rojas', 1), llegada(1, 'polos', 5), llegada(1, 'gorras', 9)],
      [{ conversacionId: 1, monto: 80, fecha: d(6) }],
    );
    const porId = Object.fromEntries(filas.map((f) => [f.anuncioId, f.pedidos]));
    expect(porId).toEqual({ rojas: 0, polos: 1, gorras: 0 });
  });

  it('si compró antes de tocar el anuncio, el anuncio no la trajo', () => {
    const [f] = ventasPorAnuncio([llegada(1, 'rojas', 10)], [{ conversacionId: 1, monto: 80, fecha: d(2) }]);
    expect(f.pedidos).toBe(0);
  });

  it('muestra el título más reciente del anuncio', () => {
    const [f] = ventasPorAnuncio([llegada(1, 'x', 1, 'Viejo'), llegada(2, 'x', 3, 'Nuevo')], []);
    expect(f.titulo).toBe('Nuevo');
  });
});

describe('"El negocio" del reporte', () => {
  afterEach(() => jest.restoreAllMocks());

  it('suma lo que vendieron los chats de clientes (las anuladas ya vienen fuera)', async () => {
    const ventas = jest.spyOn(require('./ventas-de-chats'), 'ventasDeChats').mockResolvedValue([
      { conversacionId: 1, comprobanteId: 10, monto: 150, fecha: new Date('2026-10-02') },
    ]);
    const prisma: any = {
      leadConversacion: {
        count: jest.fn().mockResolvedValue(6),
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
      leadPedidoBorrador: { findMany: jest.fn().mockResolvedValue([{ descuentoAplicado: 5 }]) },
      leadProspecto: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const r = await new LeadsBiService(prisma, {} as any).conversionYTicket(34);
    expect(prisma.leadConversacion.findMany.mock.calls[0][0].where).toMatchObject({ prospecto: { isNot: null } });
    expect(ventas).toHaveBeenCalledWith(prisma, 34, [1, 2]);
    expect(r).toMatchObject({ pedidos: 1, vendido: 150, ticketPromedio: 150, descuentosOtorgados: 5, tasaConversion: 16.7 });
  });
});

describe('el reporte', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reparte las ventas de los chats por anuncio, sin las pruebas del negocio, y dice cuántos escribieron sin anuncio', async () => {
    const ventas = jest.spyOn(require('./ventas-de-chats'), 'ventasDeChats').mockResolvedValue([
      { conversacionId: 1, comprobanteId: 10, monto: 120, fecha: new Date('2026-10-02') },
    ]);
    const prisma: any = {
      leadAnuncioOrigen: {
        findMany: jest.fn().mockResolvedValue([
          { conversacionId: 1, anuncioId: 'rojas', tipo: 'ad', titulo: 'Rojas', url: null, imagenUrl: null, creadoEn: new Date('2026-10-01') },
          { conversacionId: 2, anuncioId: 'rojas', tipo: 'ad', titulo: 'Rojas', url: null, imagenUrl: null, creadoEn: new Date('2026-10-01') },
        ]),
      },
      leadConversacion: { count: jest.fn().mockResolvedValue(7) },
    };
    const r = await new LeadsBiService(prisma, {} as any).anuncios(14);

    expect(prisma.leadAnuncioOrigen.findMany.mock.calls[0][0].where.conversacion).toEqual({
      prospecto: { isNot: null },
    });
    expect(ventas).toHaveBeenCalledWith(prisma, 14, [1, 2]);
    expect(prisma.leadConversacion.count.mock.calls[0][0].where).toMatchObject({
      prospecto: { isNot: null },
      anuncios: { none: {} },
    });
    expect(r).toEqual({
      filas: [expect.objectContaining({ anuncioId: 'rojas', conversaciones: 2, pedidos: 1, vendido: 120 })],
      conversacionesPorAnuncio: 2,
      conversacionesSinAnuncio: 7,
    });
  });
});
