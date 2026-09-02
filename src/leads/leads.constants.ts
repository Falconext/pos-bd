// Nombre de la cola de mensajes entrantes de WhatsApp (prospectos).
export const LEADS_MESSAGES_QUEUE = 'leads-messages';

/**
 * Opciones de conexión a Redis para BullMQ, a partir de REDIS_URL.
 * Soporta `rediss://` (TLS, típico en Railway). Default: localhost:6379.
 * `maxRetriesPerRequest: null` es obligatorio para BullMQ.
 */
export function redisConnection(): Record<string, any> {
  const url = process.env.REDIS_URL;
  if (!url) return { host: 'localhost', port: 6379, maxRetriesPerRequest: null };
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
