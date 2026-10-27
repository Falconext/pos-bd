/**
 * Coexistencia: el dueño contesta desde la app WhatsApp Business de su
 * celular y la IA se tiene que enterar (ver eco-vendedor.ts).
 *
 * Lo primero que cuidan estas pruebas es que los números conectados como
 * siempre (solo API) no cambien en nada: a ellos Meta nunca les manda ecos.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import * as crypto from 'crypto';
import { ecosDeCambio, JOB_ECO_VENDEDOR, textoDeEco } from './eco-vendedor';
import { LeadsWebhookController } from './leads-webhook.controller';
import { LeadsMessageProcessor } from './leads-message.processor';

const SECRETO = 'secreto-de-prueba';

const cambioEco = (ecos: any[]) => ({
  field: 'smb_message_echoes',
  value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '51915000111', phone_number_id: 'PN1' },
    message_echoes: ecos,
  },
});

describe('lectura de ecos', () => {
  it('un cambio que no es smb_message_echoes no da ecos (los números de siempre)', () => {
    expect(
      ecosDeCambio({
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PN1' },
          messages: [{ from: '51999', id: 'wamid.A', type: 'text', text: { body: 'hola' } }],
        },
      }),
    ).toEqual([]);
    expect(ecosDeCambio(undefined)).toEqual([]);
  });

  it('saca el destino sin "+" y el texto', () => {
    const [eco] = ecosDeCambio(
      cambioEco([
        { from: '51915000111', to: '+51999888777', id: 'wamid.E1', timestamp: '1', type: 'text', text: { body: 'Sí, hay stock' } },
      ]),
    );
    expect(eco).toEqual({
      phoneNumberId: 'PN1',
      to: '51999888777',
      messageId: 'wamid.E1',
      texto: 'Sí, hay stock',
      timestamp: '1',
    });
  });

  it('editar y borrar no son mensajes nuevos', () => {
    expect(
      ecosDeCambio(
        cambioEco([
          { to: '51999', id: 'wamid.R', type: 'revoke', revoke: { original_message_id: 'x' } },
          { to: '51999', id: 'wamid.D', type: 'edit', edit: {} },
        ]),
      ),
    ).toEqual([]);
  });

  it('imagen y documento se describen para la IA', () => {
    expect(textoDeEco({ type: 'image', image: { caption: ' catálogo ' } })).toBe('[Imagen] catálogo');
    expect(textoDeEco({ type: 'image', image: {} })).toBe('[Imagen]');
    expect(textoDeEco({ type: 'document', document: { filename: 'lista.pdf' } })).toBe('[Documento: lista.pdf]');
  });
});

describe('webhook con ecos', () => {
  const previo = process.env.META_APP_SECRET;
  beforeAll(() => (process.env.META_APP_SECRET = SECRETO));
  afterAll(() => (process.env.META_APP_SECRET = previo));

  function llamar(body: any) {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const raw = Buffer.from(JSON.stringify(body));
    const firma = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(raw).digest('hex');
    const req: any = { headers: { 'x-hub-signature-256': firma }, body, rawBody: raw };
    const res: any = { status: jest.fn().mockReturnThis(), send: jest.fn() };
    return { ctrl: new LeadsWebhookController(queue as never), queue, req, res };
  }

  it('encola el eco con su propio trabajo, no como mensaje del cliente', async () => {
    const { ctrl, queue, req, res } = llamar({
      object: 'whatsapp_business_account',
      entry: [{ changes: [cambioEco([{ to: '51999888777', id: 'wamid.E1', type: 'text', text: { body: 'ok' } }])] }],
    });
    await ctrl.receive(req, res);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][0]).toBe(JOB_ECO_VENDEDOR);
    expect(queue.add.mock.calls[0][2].jobId).toBe('eco-wamid.E1');
  });

  it('un mensaje normal se encola igual que antes', async () => {
    const { ctrl, queue, req, res } = llamar({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PN1' },
                messages: [{ from: '51999', id: 'wamid.A', type: 'text', text: { body: 'hola' } }],
              },
            },
          ],
        },
      ],
    });
    await ctrl.receive(req, res);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][0]).toBe('incoming');
    expect(queue.add.mock.calls[0][2].jobId).toBe('in-wamid.A');
  });
});

describe('procesar el eco', () => {
  function armar(conv: { botActivo: boolean; pausadoHasta: Date | null; prospecto?: { id: number } | null }, extra: { yaGuardado?: boolean; propio?: boolean; sinEmpresa?: boolean } = {}) {
    const creados: any[] = [];
    const updates: any[] = [];
    const prisma = {
      empresa: { findFirst: jest.fn().mockResolvedValue(extra.sinEmpresa ? null : { id: 7 }) },
      leadMensaje: {
        findUnique: jest.fn().mockResolvedValue(extra.yaGuardado ? { id: 1 } : null),
        findFirst: jest.fn().mockResolvedValue(extra.propio ? { id: 2 } : null),
        create: jest.fn(async ({ data }: any) => {
          creados.push(data);
          return { id: 3 };
        }),
      },
      leadConversacion: {
        upsert: jest.fn().mockResolvedValue({ id: 50, prospecto: null, ...conv }),
        update: jest.fn(async (a: any) => {
          updates.push({ tabla: 'conv', ...a });
          return {};
        }),
      },
      leadProspecto: {
        update: jest.fn(async (a: any) => {
          updates.push({ tabla: 'prospecto', ...a });
          return {};
        }),
      },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    const p = new LeadsMessageProcessor(
      prisma as never,
      ...(Array.from({ length: 11 }, () => ({}) as never) as []),
    );
    const job = {
      name: JOB_ECO_VENDEDOR,
      data: { phoneNumberId: 'PN1', to: '51999888777', messageId: 'wamid.E1', texto: 'Te lo separo' },
    };
    return { p, job, prisma, creados, updates };
  }

  it('guarda la respuesta del dueño como del vendedor y pausa la IA un rato', async () => {
    const { p, job, creados, updates } = armar({ botActivo: true, pausadoHasta: null, prospecto: { id: 9 } });
    await p.process(job as never);
    expect(creados).toEqual([
      { conversacionId: 50, rol: 'SISTEMA', contenido: 'Te lo separo', whatsappMsgId: 'wamid.E1' },
    ]);
    const conv = updates.find((u) => u.tabla === 'conv');
    expect(conv.data.botActivo).toBe(false);
    expect(conv.data.pausadoHasta).toBeInstanceOf(Date);
    expect(conv.data.motivoPausa).toBe('respondió desde el celular');
    expect(updates.find((u) => u.tabla === 'prospecto').data.botActivo).toBe(false);
  });

  it('una pausa sin vencimiento (derivado o IA apagada) no se toca', async () => {
    const { p, job, updates } = armar({ botActivo: false, pausadoHasta: null, prospecto: { id: 9 } });
    await p.process(job as never);
    const conv = updates.find((u) => u.tabla === 'conv');
    expect(conv.data).toEqual({ cantidadMensajes: { increment: 1 } });
    expect(updates.find((u) => u.tabla === 'prospecto')).toBeUndefined();
  });

  it('el mismo eco dos veces no se guarda dos veces', async () => {
    const { p, job, creados, updates } = armar({ botActivo: true, pausadoHasta: null }, { yaGuardado: true });
    await p.process(job as never);
    expect(creados).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('si el eco es un mensaje que mandó la propia IA, no se pausa a sí misma', async () => {
    const { p, job, creados, updates } = armar({ botActivo: true, pausadoHasta: null }, { propio: true });
    await p.process(job as never);
    expect(creados).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('un número que no es de ninguna empresa se ignora', async () => {
    const { p, job, prisma } = armar({ botActivo: true, pausadoHasta: null }, { sinEmpresa: true });
    await p.process(job as never);
    expect(prisma.leadConversacion.upsert).not.toHaveBeenCalled();
  });
});
