/**
 * Messenger y comentarios de Instagram al llegar (2026-10-26): por dónde se
 * ubica la empresa, cuándo un comentario se descarta y cómo queda marcada la
 * conversación para que la primera respuesta salga como respuesta privada.
 */
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import * as crypto from 'crypto';
import { LeadsMessageProcessor } from './leads-message.processor';
import { LeadsWebhookController } from './leads-webhook.controller';
import { textoDeComentario } from '../instagram/instagram-webhook';

/** Corta el flujo justo después del upsert: lo que importa es con qué se llamó. */
const CORTE = new Error('corte');

function procesador(empresa: any, existente: any = null) {
  const prisma: any = {
    empresa: { findFirst: jest.fn().mockResolvedValue(empresa) },
    leadConversacion: {
      findUnique: jest.fn().mockResolvedValue(existente),
      upsert: jest.fn().mockRejectedValue(CORTE),
    },
  };
  const whatsapp = {
    perfilInstagram: jest.fn().mockResolvedValue({ usuario: 'ana' }),
    perfilMessenger: jest.fn().mockResolvedValue({ nombre: 'Ana Pérez' }),
  };
  const p = Object.create(LeadsMessageProcessor.prototype);
  p.prisma = prisma;
  p.whatsapp = whatsapp;
  p.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  return { p, prisma, whatsapp };
}

const comentario = (texto: string) => ({
  canal: 'INSTAGRAM',
  instagramAccountId: '178',
  from: 'ig:555',
  messageId: 'igc:c1',
  text: textoDeComentario(texto),
  esAudio: false,
  comentarioId: 'c1',
  comentarioTexto: texto,
  nombre: '@ana',
});

describe('comentarios de Instagram', () => {
  it('con la opción apagada no se guarda nada', async () => {
    const { p, prisma } = procesador({ id: 7, instagramComentarios: false });
    await p.ingresar(comentario('precio?'));
    expect(prisma.leadConversacion.upsert).not.toHaveBeenCalled();
  });

  it('con palabras clave, un comentario que no las menciona se ignora', async () => {
    const { p, prisma } = procesador({ id: 7, instagramComentarios: true, instagramComentariosClave: 'precio, info' });
    await p.ingresar(comentario('qué lindo 😍'));
    expect(prisma.leadConversacion.upsert).not.toHaveBeenCalled();
  });

  it('el que calza abre la conversación marcada con el comentario', async () => {
    const { p, prisma } = procesador({ id: 7, instagramComentarios: true, instagramComentariosClave: 'precio' });
    await expect(p.ingresar(comentario('¿Precio?'))).rejects.toBe(CORTE);
    const arg = prisma.leadConversacion.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ telefonoProspecto: 'ig:555', canal: 'INSTAGRAM', igComentarioId: 'c1', nombreProspecto: '@ana' });
    expect(arg.update).toMatchObject({ igComentarioId: 'c1', igComentarioRespondido: false });
  });

  it('si ya conversan por DM, el comentario entra como un mensaje más (sin respuesta privada)', async () => {
    const { p, prisma } = procesador(
      { id: 7, instagramComentarios: true },
      { id: 40, igComentarioId: null, nombreProspecto: '@ana' },
    );
    const d: any = comentario('y en negro?');
    await expect(p.ingresar(d)).rejects.toBe(CORTE);
    const arg = prisma.leadConversacion.upsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({ igComentarioId: null });
    expect(d.text).not.toMatch(/mensaje privado/);
  });

  it('un DM después del comentario vuelve la conversación a normal', async () => {
    const { p, prisma } = procesador({ id: 7 }, { nombreProspecto: '@ana' });
    await expect(
      p.ingresar({ canal: 'INSTAGRAM', instagramAccountId: '178', from: 'ig:555', messageId: 'ig:m1', text: 'hola', esAudio: false }),
    ).rejects.toBe(CORTE);
    expect(prisma.leadConversacion.upsert.mock.calls[0][0].update).toMatchObject({
      igComentarioId: null,
      igComentarioRespondido: false,
    });
  });
});

describe('Messenger', () => {
  it('ubica la empresa por la página y pide el nombre del cliente', async () => {
    const { p, prisma, whatsapp } = procesador({ id: 9 });
    await expect(
      p.ingresar({ canal: 'MESSENGER', facebookPageId: '1020', from: 'fb:888', messageId: 'fb:m1', text: 'hola', esAudio: false }),
    ).rejects.toBe(CORTE);
    expect(prisma.empresa.findFirst.mock.calls[0][0].where).toEqual({ facebookPageId: '1020', facebookActivo: true });
    expect(whatsapp.perfilMessenger).toHaveBeenCalledWith('fb:888', 9);
    const arg = prisma.leadConversacion.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ canal: 'MESSENGER', telefonoProspecto: 'fb:888', nombreProspecto: 'Ana Pérez' });
    // Messenger no toca la marca de comentarios de Instagram.
    expect(arg.update.igComentarioId).toBeUndefined();
  });

  it('una página sin empresa conectada se ignora', async () => {
    const { p, prisma } = procesador(null);
    await p.ingresar({ canal: 'MESSENGER', facebookPageId: 'x', from: 'fb:1', messageId: 'fb:m', text: 'hola', esAudio: false });
    expect(prisma.leadConversacion.upsert).not.toHaveBeenCalled();
  });

  it('el webhook de una página (firmado) se encola', async () => {
    const SECRETO = 'secreto-de-prueba';
    const previo = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = SECRETO;
    try {
      const body = {
        object: 'page',
        entry: [{ id: '1020', messaging: [{ sender: { id: '888' }, recipient: { id: '1020' }, message: { mid: 'm.1', text: 'hola' } }] }],
      };
      const raw = Buffer.from(JSON.stringify(body));
      const firma = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(raw).digest('hex');
      const queue = { add: jest.fn().mockResolvedValue({}) };
      const res: any = { status: () => res, send: jest.fn() };
      await new LeadsWebhookController(queue as never).receive(
        { headers: { 'x-hub-signature-256': firma }, body, rawBody: raw } as any,
        res,
      );
      expect(queue.add.mock.calls[0][1]).toMatchObject({ canal: 'MESSENGER', facebookPageId: '1020', from: 'fb:888' });
      expect(queue.add.mock.calls[0][2].jobId).toBe('in-fb-m.1');
    } finally {
      process.env.META_APP_SECRET = previo;
    }
  });
});
