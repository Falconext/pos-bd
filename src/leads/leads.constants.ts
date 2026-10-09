// Nombre de la cola de mensajes entrantes de WhatsApp (prospectos).
export const LEADS_MESSAGES_QUEUE = 'leads-messages';

/**
 * Los dos trabajos de la cola. Están separados a propósito: guardar un mensaje
 * es por mensaje, responder es por conversación. Si fuera un solo trabajo, al
 * descartar el duplicado para no contestar tres veces también se perderían los
 * mensajes segundo y tercero.
 */
export const JOB_INGRESAR_MENSAJE = 'incoming';
export const JOB_RESPONDER = 'responder';

/**
 * Cuánto espera la IA antes de contestar, para juntar los mensajes que el
 * cliente manda seguidos ("hola" / "tienen berberina?" / "y cuánto cuesta").
 * El trabajo de respuesta lleva un id por conversación, así que mientras hay
 * uno esperando los mensajes nuevos no programan otro: entran al mismo lote.
 *
 * La espera no se reinicia con cada mensaje. Seis segundos cubren a quien
 * escribe en ráfaga sin que parezca que el bot se quedó dormido.
 */
export const DEBOUNCE_RESPUESTA_MS = 6_000;

/**
 * Opciones de conexión a Redis para BullMQ, a partir de REDIS_URL.
 * Soporta `rediss://` (TLS, típico en Railway). Default: localhost:6379.
 * `maxRetriesPerRequest: null` es obligatorio para BullMQ.
 */
export function redisConnection(): Record<string, any> {
  const url = process.env.REDIS_URL;
  if (!url)
    return { host: 'localhost', port: 6379, maxRetriesPerRequest: null };
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

/**
 * Tope de caracteres del cuerpo de un mensaje de texto en la Cloud API de Meta.
 * Se valida antes de llamar a la API para fallar con un mensaje claro en vez de
 * un 400 opaco de Graph.
 */
export const LIMITE_TEXTO_WHATSAPP = 4096;
