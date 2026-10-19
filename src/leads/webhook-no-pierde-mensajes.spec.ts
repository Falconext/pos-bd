/**
 * El webhook no le dice "recibido" a Meta hasta tener el mensaje en la cola.
 *
 * 19-10: un cliente escribió "Habla p Tone" al 915, le salió doble check y
 * nunca hubo conversación. El 200 salía antes de encolar: si la cola fallaba,
 * Meta ya tenía su OK y no reintentaba.
 */
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
}));

import * as crypto from 'crypto';
import { LeadsWebhookController } from './leads-webhook.controller';

const SECRETO = 'secreto-de-prueba';

function llamar(queue: { add: jest.Mock }) {
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '1372645942600125' },
              contacts: [{ wa_id: '51999888777', profile: { name: 'Tone' } }],
              messages: [
                { from: '51999888777', id: 'wamid.X', type: 'text', text: { body: 'Habla p Tone' } },
              ],
            },
          },
        ],
      },
    ],
  };
  const raw = Buffer.from(JSON.stringify(body));
  const firma =
    'sha256=' + crypto.createHmac('sha256', SECRETO).update(raw).digest('hex');
  const req: any = { headers: { 'x-hub-signature-256': firma }, body, rawBody: raw };
  const res: any = {
    estado: 0,
    status(c: number) {
      this.estado = c;
      return this;
    },
    send: jest.fn(),
  };
  const ctrl = new LeadsWebhookController(queue as never);
  return { ctrl, req, res };
}

describe('webhook de leads: primero encolar, después contestar', () => {
  const previo = process.env.META_APP_SECRET;
  beforeAll(() => (process.env.META_APP_SECRET = SECRETO));
  afterAll(() => (process.env.META_APP_SECRET = previo));

  it('si la cola falla, contesta 500 para que Meta reintente', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis caído')) };
    const { ctrl, req, res } = llamar(queue);
    await ctrl.receive(req, res);
    expect(res.estado).toBe(500);
    expect(res.send).toHaveBeenCalledTimes(1);
  });

  it('con el mensaje en la cola, contesta 200', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const { ctrl, req, res } = llamar(queue);
    await ctrl.receive(req, res);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2].jobId).toBe('in-wamid.X');
    expect(res.estado).toBe(200);
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});

describe('usuario con @nick: Meta no manda su teléfono', () => {
  const previo = process.env.META_APP_SECRET;
  beforeAll(() => (process.env.META_APP_SECRET = SECRETO));
  afterAll(() => (process.env.META_APP_SECRET = previo));

  it('se encola con su BSUID en vez de perderse', async () => {
    // Forma del ejemplo de Meta (business-scoped user IDs): sin `from` ni
    // `wa_id`, con `from_user_id` y `contacts[].user_id`.
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '1372645942600125' },
        contacts: [{ profile: { name: 'Tone', username: 'tone.pe' }, user_id: 'PE.13491208655302741918' }],
        messages: [{ from_user_id: 'PE.13491208655302741918', id: 'wamid.Y', type: 'text', text: { body: 'Deseo info' } }],
      } }] }],
    };
    const raw = Buffer.from(JSON.stringify(body));
    const firma = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(raw).digest('hex');
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const res: any = { estado: 0, status(c: number) { this.estado = c; return this; }, send: jest.fn() };
    await new LeadsWebhookController(queue as never).receive(
      { headers: { 'x-hub-signature-256': firma }, body, rawBody: raw } as any,
      res,
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
    const datos = queue.add.mock.calls[0][1];
    expect(datos.from).toBe('PE.13491208655302741918');
    expect(datos.nombre).toBe('Tone');
    expect(res.estado).toBe(200);
  });
});
