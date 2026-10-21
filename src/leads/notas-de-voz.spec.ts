/**
 * Notas de voz desde el chat del panel (21-10): al vendedor le es más rápido
 * hablar que escribir. Llegan como WEBM (navegador) o M4A (iPhone) y salen a
 * WhatsApp como OGG/Opus, que es lo único que se ve como nota de voz.
 */
import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { ARGS_OGG_OPUS, aOggOpus } from './nota-de-voz';

describe('enviarAudioManual', () => {
  const ogg = Buffer.from('OggS-falso');

  function armar(
    opts: {
      envio?: { success: boolean; error?: string };
      conv?: unknown;
      transcripcion?: string | Error;
      ia?: boolean;
      convertir?: () => Promise<Buffer>;
    } = {},
  ) {
    const prisma: any = {
      leadConversacion: {
        findFirst: jest.fn().mockResolvedValue(
          opts.conv === undefined
            ? { id: 500, telefonoProspecto: '584245130712', botActivo: true, prospecto: { id: 9 } }
            : opts.conv,
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      leadMensaje: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      },
      leadProspecto: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    const whatsapp: any = {
      enviarAudio: jest.fn().mockResolvedValue(opts.envio ?? { success: true }),
    };
    const s3: any = {
      uploadPDF: jest.fn((_b: Buffer, key: string) => Promise.resolve(`https://s3/${key}`)),
    };
    const ia: any = {
      disponible: () => opts.ia !== false,
      transcribirAudio: jest.fn(() =>
        opts.transcripcion instanceof Error
          ? Promise.reject(opts.transcripcion)
          : Promise.resolve(opts.transcripcion ?? 'Hola, te cuento cómo se toma'),
      ),
    };
    const convertir = jest.fn(opts.convertir ?? (() => Promise.resolve(ogg)));
    const service = new LeadsService(prisma, {} as any, {} as any, whatsapp, s3, ia, convertir);
    return { service, prisma, whatsapp, s3, ia, convertir };
  }

  const webm = { buffer: Buffer.from('webm'), mimetype: 'audio/webm', size: 4 };

  it('convierte, sube el OGG, lo manda como nota de voz, lo transcribe y toma el chat', async () => {
    const { service, prisma, whatsapp, s3, ia, convertir } = armar();
    const r = await service.enviarAudioManual(89, 500, webm, 7.4);

    expect(convertir).toHaveBeenCalledWith(webm.buffer);
    const [subido, key, tipo] = s3.uploadPDF.mock.calls[0];
    expect(subido).toBe(ogg);
    expect(key).toMatch(/^ia-ventas\/empresa-89\/chat\/500-\d+\.ogg$/);
    expect(tipo).toBe('audio/ogg');
    expect(whatsapp.enviarAudio).toHaveBeenCalledWith('584245130712', ogg, 89);
    expect(ia.transcribirAudio).toHaveBeenCalledWith(ogg, 'audio/ogg');
    expect(prisma.leadMensaje.create.mock.calls[0][0].data).toMatchObject({
      conversacionId: 500,
      rol: 'SISTEMA',
      contenido: '[Nota de voz] Hola, te cuento cómo se toma',
      audioUrl: expect.stringMatching(/\.ogg$/),
      esAudio: true,
    });
    expect(r.botPausado).toBe(true);
    expect(r.mensaje).toMatchObject({ duracion: 7 });
    expect(prisma.leadProspecto.update).toHaveBeenCalled();
  });

  it('si no se puede transcribir, igual queda "[Nota de voz]"', async () => {
    for (const caso of [{ transcripcion: new Error('gemini caído') }, { transcripcion: '  ' }, { ia: false }]) {
      const { service, prisma, whatsapp } = armar(caso);
      await service.enviarAudioManual(89, 500, webm);
      expect(whatsapp.enviarAudio).toHaveBeenCalled();
      expect(prisma.leadMensaje.create.mock.calls[0][0].data.contenido).toBe('[Nota de voz]');
    }
  });

  it('si WhatsApp no la acepta, no queda en el historial ni pausa la IA', async () => {
    const { service, prisma } = armar({ envio: { success: false, error: 'fuera de la ventana de 24 h' } });
    await expect(service.enviarAudioManual(89, 500, webm)).rejects.toThrow('fuera de la ventana de 24 h');
    expect(prisma.leadMensaje.create).not.toHaveBeenCalled();
    expect(prisma.leadConversacion.update).not.toHaveBeenCalled();
  });

  it('con la IA ya en pausa no la vuelve a pausar', async () => {
    const { service } = armar({
      conv: { id: 500, telefonoProspecto: '584245130712', botActivo: false, prospecto: null },
    });
    const r = await service.enviarAudioManual(89, 500, webm);
    expect(r.botPausado).toBe(false);
  });

  it('rechaza lo que no es audio, lo vacío y lo que ffmpeg no entiende', async () => {
    const { service, whatsapp } = armar({ convertir: () => Promise.reject(new Error('Invalid data')) });
    await expect(
      service.enviarAudioManual(89, 500, { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', size: 4 }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.enviarAudioManual(89, 500, undefined)).rejects.toThrow('Falta el audio');
    await expect(service.enviarAudioManual(89, 500, webm)).rejects.toThrow('No se pudo leer el audio');
    expect(whatsapp.enviarAudio).not.toHaveBeenCalled();
  });

  it('acepta el m4a del iPhone y el video/webm que mandan algunos navegadores', async () => {
    const { service, whatsapp } = armar();
    await service.enviarAudioManual(89, 500, { buffer: Buffer.from('m4a'), mimetype: 'audio/mp4', size: 3 });
    await service.enviarAudioManual(89, 500, { buffer: Buffer.from('w'), mimetype: 'video/webm', size: 1 });
    expect(whatsapp.enviarAudio).toHaveBeenCalledTimes(2);
  });

  it('rechaza más de 16 MB y no manda a otra empresa', async () => {
    const { service } = armar({ conv: null });
    await expect(
      service.enviarAudioManual(89, 500, { buffer: Buffer.from('x'), mimetype: 'audio/ogg', size: 17 * 1024 * 1024 }),
    ).rejects.toThrow('16 MB');
    await expect(service.enviarAudioManual(90, 500, webm)).rejects.toThrow('Conversación no encontrada');
  });
});

describe('aOggOpus', () => {
  function procesoFalso(opts: { salida?: Buffer; codigo?: number; error?: string }) {
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = Object.assign(new EventEmitter(), {
      end: jest.fn(() => {
        setImmediate(() => {
          if (opts.salida) proc.stdout.emit('data', opts.salida);
          if (opts.error) proc.stderr.emit('data', Buffer.from(opts.error));
          proc.emit('close', opts.codigo ?? 0);
        });
      }),
    });
    proc.kill = jest.fn();
    return proc;
  }

  it('pasa el audio por stdin y devuelve el OGG de stdout', async () => {
    const proc = procesoFalso({ salida: Buffer.from('OggS') });
    const spawnFn = jest.fn(() => proc) as any;
    const r = await aOggOpus(Buffer.from('webm'), { ffmpeg: '/bin/ffmpeg', spawnFn });
    expect(r.toString()).toBe('OggS');
    expect(spawnFn).toHaveBeenCalledWith('/bin/ffmpeg', ARGS_OGG_OPUS, expect.anything());
    expect(proc.stdin.end).toHaveBeenCalledWith(Buffer.from('webm'));
    expect(ARGS_OGG_OPUS).toEqual(expect.arrayContaining(['libopus', 'ogg', '1']));
  });

  it('falla con el error de ffmpeg o si no devuelve nada', async () => {
    const malo = procesoFalso({ codigo: 1, error: 'Invalid data found' });
    await expect(aOggOpus(Buffer.from('x'), { spawnFn: (() => malo) as any })).rejects.toThrow('Invalid data found');
    const vacio = procesoFalso({ codigo: 0 });
    await expect(aOggOpus(Buffer.from('x'), { spawnFn: (() => vacio) as any })).rejects.toThrow('código 0');
  });
});

// Conversión de verdad, solo donde hay un ffmpeg con libopus a mano.
const ffmpegReal = (() => {
  for (const ruta of [safeFfmpegStatic(), 'ffmpeg']) {
    if (!ruta) continue;
    try {
      const encoders = execFileSync(ruta, ['-hide_banner', '-encoders'], { stdio: 'pipe' }).toString();
      if (encoders.includes('libopus')) return ruta;
    } catch {
      // no está
    }
  }
  return null;
})();

function safeFfmpegStatic(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('ffmpeg-static') as string;
  } catch {
    return null;
  }
}

(ffmpegReal ? it : it.skip)('convierte un WAV real a OGG/Opus', async () => {
  // 0,5 s de silencio en WAV PCM 16 bits mono 8 kHz.
  const muestras = 4000;
  const wav = Buffer.alloc(44 + muestras * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + muestras * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(muestras * 2, 40);
  const ogg = await aOggOpus(wav, { ffmpeg: ffmpegReal! });
  expect(ogg.subarray(0, 4).toString()).toBe('OggS');
  expect(ogg.includes(Buffer.from('OpusHead'))).toBe(true);
});
