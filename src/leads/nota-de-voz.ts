/**
 * Nota de voz que manda el vendedor desde el chat del panel.
 *
 * WhatsApp solo la muestra como nota de voz (con la onda y el botón de
 * reproducir, no como un archivo adjunto) si llega en OGG con Opus. El
 * navegador graba en WEBM y el iPhone en M4A, así que todo pasa por ffmpeg.
 *
 * Railway no trae ffmpeg: se usa el binario de `ffmpeg-static`, y si no está
 * (desarrollo local con node_modules compartidos), el `ffmpeg` del sistema.
 */
import { spawn } from 'child_process';

/** Ruta del ffmpeg a usar. */
export function rutaFfmpeg(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ruta = require('ffmpeg-static') as string | null;
    if (ruta) return ruta;
  } catch {
    // sin ffmpeg-static instalado
  }
  return 'ffmpeg';
}

/** Argumentos: OGG/Opus mono a 48 kHz y 32 kbps, lo que graba WhatsApp. */
export const ARGS_OGG_OPUS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  'pipe:0',
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
export function aOggOpus(
  entrada: Buffer,
  opciones: { ffmpeg?: string; spawnFn?: typeof spawn; timeoutMs?: number } = {},
): Promise<Buffer> {
  const ejecutar = opciones.spawnFn ?? spawn;
  return new Promise((resolve, reject) => {
    const proc = ejecutar(opciones.ffmpeg ?? rutaFfmpeg(), ARGS_OGG_OPUS, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
        reject(new Error(errores.trim() || `ffmpeg terminó con código ${codigo}`));
        return;
      }
      resolve(ogg);
    });
    // Si ffmpeg se cae antes de leer todo, escribir lanza EPIPE: ya lo
    // reporta 'close'.
    proc.stdin?.on('error', () => undefined);
    proc.stdin?.end(entrada);
  });
}
