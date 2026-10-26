/**
 * Nota de voz que manda el vendedor desde el chat del panel.
 *
 * WhatsApp solo la muestra como nota de voz (con la onda y el botón de
 * reproducir, no como un archivo adjunto) si llega en OGG con Opus. El
 * navegador graba en WEBM y el iPhone en M4A, así que todo pasa por ffmpeg.
 *
 * El ffmpeg es el del sistema: la imagen de Docker lo instala con apt (como
 * chromium para Puppeteer). FFMPEG_PATH permite apuntar a otro.
 *
 * La grabación entra como archivo temporal, no por stdin. Android graba M4A
 * con el índice (moov) al final; por una tubería ffmpeg no puede volver
 * atrás a buscarlo y, pasados unos 6 segundos de audio, devolvía solo las
 * cabeceras. Las notas de Android salían rechazadas por "sin sonido" (HS,
 * 25-10) y las del iPhone y el navegador no.
 */
import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/** Ruta del ffmpeg a usar. */
export function rutaFfmpeg(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

/** Argumentos: OGG/Opus mono a 48 kHz y 32 kbps, lo que graba WhatsApp. */
export const argsOggOpus = (entrada: string) => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  entrada,
  '-vn',
  '-ac',
  '1',
  '-ar',
  '48000',
  '-c:a',
  'libopus',
  '-b:a',
  '32k',
  '-application',
  'voip',
  '-f',
  'ogg',
  'pipe:1',
];

/**
 * Convierte cualquier audio a OGG/Opus. Falla si ffmpeg no lo entiende o si
 * no devuelve nada (un archivo vacío no es una nota de voz).
 */
export async function aOggOpus(
  entrada: Buffer,
  opciones: {
    ffmpeg?: string;
    spawnFn?: typeof spawn;
    timeoutMs?: number;
  } = {},
): Promise<Buffer> {
  const carpeta = await mkdtemp(join(tmpdir(), 'nota-voz-'));
  const archivo = join(carpeta, 'entrada');
  try {
    await writeFile(archivo, entrada);
    return await convertir(archivo, opciones);
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
  }
}

function convertir(
  archivo: string,
  opciones: { ffmpeg?: string; spawnFn?: typeof spawn; timeoutMs?: number },
): Promise<Buffer> {
  const ejecutar = opciones.spawnFn ?? spawn;
  return new Promise((resolve, reject) => {
    const proc = ejecutar(
      opciones.ffmpeg ?? rutaFfmpeg(),
      argsOggOpus(archivo),
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const salida: Buffer[] = [];
    let errores = '';
    const reloj = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg tardó demasiado'));
    }, opciones.timeoutMs ?? 30_000);

    proc.stdout?.on('data', (d: Buffer) => salida.push(d));
    proc.stderr?.on('data', (d: Buffer) => (errores += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(reloj);
      reject(e);
    });
    proc.on('close', (codigo) => {
      clearTimeout(reloj);
      const ogg = Buffer.concat(salida);
      if (codigo !== 0 || !ogg.length) {
        reject(
          new Error(errores.trim() || `ffmpeg terminó con código ${codigo}`),
        );
        return;
      }
      resolve(ogg);
    });
  });
}

/**
 * ¿El OGG trae sonido, o solo las cabeceras?
 *
 * Hierba Sana, 23-10: dos notas de voz al mismo cliente salieron de 348
 * bytes — la página OpusHead y la OpusTags, ningún paquete de audio. El
 * micrófono no entregó nada (el navegador a veces arranca con la pista
 * muda), ffmpeg terminó bien igual, y a WhatsApp se le mandó una nota que
 * el cliente no podía reproducir. Una página con audio tiene posición de
 * granulo mayor que cero; las de cabecera, cero.
 */
export function tieneAudio(ogg: Buffer): boolean {
  let i = ogg.indexOf('OggS');
  while (i >= 0 && i + 14 <= ogg.length) {
    if (ogg.readBigInt64LE(i + 6) > 0n) return true;
    i = ogg.indexOf('OggS', i + 4);
  }
  return false;
}
