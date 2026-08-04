import type { NextFunction, Request, Response } from 'express';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const CLEANUP_MS = 5 * 60 * 1000;
let lastCleanup = 0;

// Solo se protegen los endpoints de adivinación de credenciales.
// IMPORTANTE: /api/auth/refresh y /api/auth/select-sede NO se limitan a
// propósito: no son vectores de fuerza bruta y el auto-refresh del token en el
// frontend generaba falsos positivos que terminaban bloqueando a usuarios
// legítimos (y, si compartían IP/proxy, a varios a la vez).
const SENSITIVE_PATHS = [
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

// Regla por ruta.
//  - onlyFailed=true  → SOLO cuentan los intentos FALLIDOS (status >= 400).
//    Un inicio de sesión correcto jamás incrementa el contador, así que un
//    usuario que funciona bien NUNCA se bloquea, por más veces que entre.
//  - onlyFailed=false → cuenta todos los intentos (p. ej. forgot-password,
//    que dispara envío de correos y conviene acotar aunque respondan 200).
function ruleFor(path: string): { limit: number; onlyFailed: boolean } {
  if (path.startsWith('/api/auth/login')) return { limit: 15, onlyFailed: true };
  if (path.startsWith('/api/auth/reset-password')) return { limit: 15, onlyFailed: true };
  // forgot-password
  return { limit: 15, onlyFailed: false };
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] ?? req.ip ?? 'unknown';
  if (forwarded) return forwarded.split(',')[0]?.trim() || req.ip || 'unknown';
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// En desarrollo local (loopback) no aplicamos el límite. En producción, detrás
// de un proxy, clientIp devuelve la IP real vía x-forwarded-for.
function isLoopback(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost'
  );
}

// Interruptor de emergencia: RATE_LIMIT_DISABLED=true desactiva el límite por
// completo (útil si algo sale mal en producción y hay que restablecer acceso ya).
const RATE_LIMIT_DISABLED =
  String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true';

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function bump(key: string, now: number) {
  const b = buckets.get(key);
  if (b && b.resetAt > now) {
    b.count += 1;
  } else {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  }
}

export function authRateLimit() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') return next();

    const path = req.path || req.originalUrl || '';
    const isSensitive = SENSITIVE_PATHS.some((item) => path.startsWith(item));
    if (!isSensitive) return next();

    const ip = clientIp(req);
    if (RATE_LIMIT_DISABLED || isLoopback(ip)) return next();

    const now = Date.now();
    cleanup(now);

    const key = `${ip}:${path}`;
    const { limit, onlyFailed } = ruleFor(path);

    const current = buckets.get(key);
    const count = current && current.resetAt > now ? current.count : 0;
    const resetAt = current && current.resetAt > now ? current.resetAt : now + WINDOW_MS;

    // Bloquear solo cuando ya se acumularon demasiados intentos (fallidos) en la
    // ventana. No se incrementa aquí: el conteo ocurre al finalizar la respuesta.
    if (count >= limit) {
      res.setHeader('Retry-After', Math.ceil((resetAt - now) / 1000));
      return res.status(429).json({
        code: 0,
        message: 'Demasiados intentos fallidos. Intenta nuevamente en unos minutos.',
        error: 'TooManyRequests',
      });
    }

    // Contar el intento al terminar la respuesta:
    //  - onlyFailed → solo si la respuesta fue un error (>= 400).
    //  - si no → siempre.
    res.on('finish', () => {
      const failed = res.statusCode >= 400;
      if (!onlyFailed || failed) bump(key, Date.now());
    });

    next();
  };
}
