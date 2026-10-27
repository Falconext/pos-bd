/**
 * Fotos y notas de voz en el chat de soporte, en los dos sentidos.
 */
jest.mock('../leads/nota-de-voz', () => ({
  aOggOpus: jest.fn(async () => Buffer.from('OggS-falso')),
  tieneAudio: jest.fn(() => true),
}));

import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';
import { SoporteService } from './soporte.service';

function armar() {
  const creados: any[] = [];
  const eventos: any[] = [];
  const prisma: any = {
    soporteConversacion: {
      findUnique: jest.fn(async () => ({ id: 7, empresaId: 5, noLeidosEmpresa: 0 })),
      findFirst: jest.fn(async () => ({ id: 7, empresaId: 5 })),
      update: jest.fn(async () => ({ id: 7, noLeidosSistema: 2 })),
    },
    soporteMensaje: {
      create: jest.fn(async ({ data }: any) => {
        creados.push(data);
        return { id: 99, ...data };
      }),
    },
    usuario: {
      findUnique: jest.fn(async () => ({ nombre: 'Ana' })),
      findMany: jest.fn(async () => [{ id: 1 }]),
    },
    empresa: { findUnique: jest.fn(async () => ({ brand: 'krezka', nombreComercial: 'Bodega Ana' })) },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };
  const notificaciones: any = { emitirEventoAUsuarios: jest.fn((_u: any, _e: any, p: any) => eventos.push(p)) };
  const bot = { responder: jest.fn(async () => null) };
  const s3 = { uploadPDF: jest.fn(async (_b: Buffer, key: string, _tipo?: string) => `https://s3/${key}`) };
  const servicio = new SoporteService(prisma, notificaciones, bot as any, undefined, s3 as any);
  return { servicio, creados, eventos, bot, s3 };
}

const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#7c3aed' } }).png().toBuffer();

describe('foto del empresario', () => {
  it('se sube como JPG, queda en el mensaje y viaja en el aviso en vivo', async () => {
    const { servicio, creados, eventos, s3, bot } = armar();
    await servicio.enviarAdjuntoEmpresa(5, 1, 'imagen', { buffer: await png(), mimetype: 'image/png', size: 100 }, 'me sale esto');
    expect(s3.uploadPDF.mock.calls[0][2]).toBe('image/jpeg');
    expect(creados[0]).toMatchObject({ rol: 'EMPRESA', contenido: '[Imagen] me sale esto' });
    expect(creados[0].imagenUrl).toMatch(/^https:\/\/s3\/soporte\/empresa-5\/.*\.jpg$/);
    expect(eventos[0].imagenUrl).toBe(creados[0].imagenUrl);
    // Una foto no la lee el asistente: que la vea una persona.
    expect(bot.responder).not.toHaveBeenCalled();
  });

  it('un archivo que no es imagen se rechaza', async () => {
    const { servicio } = armar();
    await expect(
      servicio.enviarAdjuntoEmpresa(5, 1, 'imagen', { buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('nota de voz', () => {
  it('del empresario: va a OGG y se guarda como [Nota de voz]', async () => {
    const { servicio, creados, s3 } = armar();
    await servicio.enviarAdjuntoEmpresa(5, 1, 'audio', { buffer: Buffer.from('webm'), mimetype: 'audio/webm', size: 4 });
    expect(s3.uploadPDF.mock.calls[0][2]).toBe('audio/ogg');
    expect(creados[0]).toMatchObject({ contenido: '[Nota de voz]' });
    expect(creados[0].audioUrl).toMatch(/\.ogg$/);
  });

  it('del equipo de Krezka: llega a la empresa con su audio', async () => {
    const { servicio, creados, eventos } = armar();
    await servicio.enviarAdjuntoSistema(7, null, 2, 'audio', { buffer: Buffer.from('webm'), mimetype: 'video/webm', size: 4 });
    expect(creados[0]).toMatchObject({ rol: 'SISTEMA', contenido: '[Nota de voz]' });
    expect(eventos[0]).toMatchObject({ rol: 'SISTEMA', audioUrl: creados[0].audioUrl });
  });
});
