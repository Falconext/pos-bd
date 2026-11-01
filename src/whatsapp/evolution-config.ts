/**
 * Configuración de Evolution API (variables de entorno). Se lee en cada
 * llamada para que encender o apagar el piloto no exija tocar código.
 *
 * Apagado por defecto: sin EVOLUTION_API_URL, EVOLUTION_API_KEY o
 * EVOLUTION_WEBHOOK_SECRET nada cambia
 * (todo responde `disponible: false` y los avisos siguen por Takiy/Meta).
 */

export interface EvolutionEnv {
  url: string;
  apiKey: string;
  webhookSecret: string;
  /** Base del backend (sin /api) a la que Evolution manda los eventos. */
  webhookBase: string;
  piloto: '*' | Set<number>;
  topeDiario: number;
  pausaMinMs: number;
  pausaMaxMs: number;
  colaMax: number;
}

const entero = (v: string | undefined, def: number, min = 0): number => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : def;
};

export function leerEvolutionEnv(
  env: NodeJS.ProcessEnv = process.env,
): EvolutionEnv | null {
  const url = (env.EVOLUTION_API_URL ?? '').trim();
  const apiKey = (env.EVOLUTION_API_KEY ?? '').trim();
  const webhookSecret = (env.EVOLUTION_WEBHOOK_SECRET ?? '').trim();
  // Sin secreto el webhook no se podría autenticar: se trata como apagado.
  if (!url || !apiKey || !webhookSecret) return null;

  const pilotoRaw = (env.EVOLUTION_EMPRESAS_PILOTO ?? '').trim();
  const piloto: '*' | Set<number> =
    pilotoRaw === '*'
      ? '*'
      : new Set(
          pilotoRaw
            .split(',')
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => Number.isInteger(n) && n > 0),
        );

  const pausaMinMs = entero(env.EVOLUTION_PAUSA_MIN_MS, 3_000);
  const pausaMaxMs = Math.max(
    pausaMinMs,
    entero(env.EVOLUTION_PAUSA_MAX_MS, 7_000),
  );

  // En Railway conviene la URL privada del backend (http://<servicio>.railway.internal:<puerto>).
  const webhookBase = (
    env.EVOLUTION_WEBHOOK_BASE_URL ||
    env.BACKEND_URL ||
    'http://localhost:4001'
  )
    .trim()
    .replace(/\/+$/, '');

  return {
    url,
    apiKey,
    webhookSecret,
    webhookBase,
    piloto,
    topeDiario: entero(env.EVOLUTION_TOPE_DIARIO, 300, 1),
    pausaMinMs,
    pausaMaxMs,
    colaMax: entero(env.EVOLUTION_COLA_MAX, 20, 1),
  };
}

/** ¿Esta empresa puede usar Evolution? (configurado + dentro del piloto). */
export function evolutionDisponible(
  empresaId: number,
  cfg: EvolutionEnv | null,
): cfg is EvolutionEnv {
  if (!cfg) return false;
  if (cfg.piloto === '*') return true;
  return cfg.piloto.has(empresaId);
}

/** Ruta del webhook (el backend usa el prefijo global /api). */
export const RUTA_WEBHOOK_EVOLUTION = '/api/whatsapp/evolution/webhook';
