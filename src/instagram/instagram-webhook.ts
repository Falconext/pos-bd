import { destinoInstagram } from './instagram-texto';
import { destinoMessenger } from '../messenger/messenger-texto';

/** Un mensaje de Instagram o Messenger listo para la misma cola que los de WhatsApp. */
export interface MensajeMeta {
  canal: 'INSTAGRAM' | 'MESSENGER';
  /** Instagram: cuenta profesional que recibió el mensaje (por ella se ubica la empresa). */
  instagramAccountId?: string;
  /** Messenger: página de Facebook que recibió el mensaje. */
  facebookPageId?: string;
  /** `ig:<id>` o `fb:<id>`: así se guarda el cliente en la conversación. */
  from: string;
  messageId: string;
  text: string;
  esAudio: boolean;
  esImagen: boolean;
  esDocumento: boolean;
  /** El adjunto llega como URL; se baja directo de ahí. */
  mediaId?: string;
  timestamp?: string;
  /** Instagram: vino de un comentario en una publicación, no de un DM. */
  comentarioId?: string;
  /** Texto crudo del comentario, para filtrar por palabras clave. */
  comentarioTexto?: string;
  nombre?: string;
}

/** Compatibilidad con el nombre de antes. */
export type MensajeInstagram = MensajeMeta;

/**
 * Los mensajes de un webhook de Instagram (`object: "instagram"`) o de una
 * página de Facebook (`object: "page"`). Las dos redes mandan `messaging` con
 * la misma forma; cambia el prefijo del cliente y por dónde se ubica la empresa.
 *
 * Se descartan:
 *  - Los "eco" (`is_echo`): son los mensajes que manda la propia cuenta, sea el
 *    bot, el panel o alguien desde la app. Si se procesaran, el bot se
 *    contestaría a sí mismo.
 *  - Los que no son mensajes (leídos, reacciones, mensajes borrados).
 *  - Lo que no se sabe manejar (stickers, compartir un post sin texto).
 */
function mensajesDeMeta(body: any, canal: 'INSTAGRAM' | 'MESSENGER'): MensajeMeta[] {
  const salida: MensajeMeta[] = [];
  const prefijo = canal === 'INSTAGRAM' ? 'ig' : 'fb';
  for (const entry of body.entry ?? []) {
    const cuenta = String(entry?.id ?? '');
    for (const ev of entry?.messaging ?? []) {
      const m = ev?.message;
      if (!m || m.is_echo || m.is_deleted || m.is_unsupported) continue;
      const remitente = String(ev?.sender?.id ?? '');
      if (!remitente || !cuenta || remitente === cuenta) continue;
      if (!m.mid) continue;

      const adjunto = (m.attachments ?? [])[0];
      const tipo = String(adjunto?.type ?? '');
      const url: string | undefined = adjunto?.payload?.url;
      const texto = String(m.text ?? '').trim();

      let text: string | null;
      if (texto && !adjunto) text = texto;
      else if (tipo === 'image') text = texto ? `[el cliente envió una imagen] ${texto}` : '[el cliente envió una imagen]';
      else if (tipo === 'audio') text = '';
      else if (tipo === 'file') text = '[el cliente envió un documento]';
      else if (tipo === 'video') text = texto ? `[el cliente envió un video] ${texto}` : '[el cliente envió un video]';
      else if (texto) text = texto;
      else text = null;
      if (text === null) continue;

      salida.push({
        canal,
        ...(canal === 'INSTAGRAM' ? { instagramAccountId: cuenta } : { facebookPageId: cuenta }),
        from: canal === 'INSTAGRAM' ? destinoInstagram(remitente) : destinoMessenger(remitente),
        messageId: `${prefijo}:${m.mid}`,
        text,
        esAudio: tipo === 'audio',
        esImagen: tipo === 'image',
        esDocumento: tipo === 'file',
        mediaId: url && ['audio', 'image', 'file'].includes(tipo) ? url : undefined,
        timestamp: ev.timestamp ? String(Math.floor(Number(ev.timestamp) / 1000)) : undefined,
      });
    }
  }
  return salida;
}

export function mensajesDeInstagram(body: any): MensajeMeta[] {
  if (body?.object !== 'instagram') return [];
  return [...mensajesDeMeta(body, 'INSTAGRAM'), ...comentariosDeInstagram(body)];
}

export function mensajesDeMessenger(body: any): MensajeMeta[] {
  if (body?.object !== 'page') return [];
  return mensajesDeMeta(body, 'MESSENGER');
}

/**
 * Comentarios en publicaciones (`changes[].field === "comments"`).
 *
 * Entran a la misma cola como si el cliente hubiera escrito, con el texto
 * envuelto en una indicación para la IA: su respuesta llega como UN mensaje
 * privado (es lo que permite Meta), así que tiene que ser solo texto y breve.
 * Si la empresa no tiene activa la respuesta a comentarios, el procesador lo
 * descarta antes de guardar nada.
 *
 * Se descartan los comentarios de la propia cuenta (sus respuestas públicas).
 */
export function comentariosDeInstagram(body: any): MensajeMeta[] {
  if (body?.object !== 'instagram') return [];
  const salida: MensajeMeta[] = [];
  for (const entry of body.entry ?? []) {
    const cuenta = String(entry?.id ?? '');
    for (const ch of entry?.changes ?? []) {
      if (ch?.field !== 'comments') continue;
      const v = ch?.value ?? {};
      const autor = String(v?.from?.id ?? '');
      const id = String(v?.id ?? '');
      const texto = String(v?.text ?? '').trim();
      if (!autor || !id || !cuenta || autor === cuenta || !texto) continue;
      const usuario = v?.from?.username ? String(v.from.username) : '';
      salida.push({
        canal: 'INSTAGRAM',
        instagramAccountId: cuenta,
        from: destinoInstagram(autor),
        messageId: `igc:${id}`,
        text: textoDeComentario(texto),
        esAudio: false,
        esImagen: false,
        esDocumento: false,
        comentarioId: id,
        comentarioTexto: texto,
        nombre: usuario ? `@${usuario}` : undefined,
        timestamp: entry?.time ? String(Math.floor(Number(entry.time) > 1e12 ? Number(entry.time) / 1000 : Number(entry.time))) : undefined,
      });
    }
  }
  return salida;
}

/** Lo que lee la IA cuando alguien comenta en una publicación. */
export function textoDeComentario(texto: string): string {
  return (
    `[El cliente comentó en una publicación de Instagram: "${texto}". ` +
    'Tu respuesta le llega como UN solo mensaje privado y no podrás mandarle nada más hasta que te conteste: ' +
    'que sea solo texto, breve y cordial, que responda lo que preguntó si puedes y que lo invite a seguir la conversación por aquí. ' +
    'No mandes fotos, catálogos ni enlaces largos todavía.]'
  );
}

/** ¿El comentario menciona alguna de las palabras clave? Sin palabras, todos valen. */
export function comentarioCalza(texto: string, clave: string | null | undefined): boolean {
  const palabras = String(clave ?? '')
    .split(',')
    .map((p) => normalizar(p))
    .filter(Boolean);
  if (!palabras.length) return true;
  const t = normalizar(texto);
  return palabras.some((p) => t.includes(p));
}

const normalizar = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
