import { destinoInstagram } from './instagram-texto';

/** Un mensaje de Instagram listo para la misma cola que los de WhatsApp. */
export interface MensajeInstagram {
  canal: 'INSTAGRAM';
  /** Cuenta profesional que recibió el mensaje: por ella se ubica la empresa. */
  instagramAccountId: string;
  /** `ig:<id del usuario>`: así se guarda el cliente en la conversación. */
  from: string;
  messageId: string;
  text: string;
  esAudio: boolean;
  esImagen: boolean;
  esDocumento: boolean;
  /** En Instagram el adjunto llega como URL; se baja directo de ahí. */
  mediaId?: string;
  timestamp?: string;
}

/**
 * Los mensajes que trae un webhook de Instagram (`object: "instagram"`).
 *
 * Se descartan:
 *  - Los "eco" (`is_echo`): son los mensajes que manda la propia cuenta, sea el
 *    bot, el panel o alguien desde la app de Instagram. Si se procesaran, el bot
 *    se contestaría a sí mismo.
 *  - Los que no son mensajes (leídos, reacciones, mensajes borrados).
 *  - Lo que no se sabe manejar (stickers, compartir un post sin texto).
 */
export function mensajesDeInstagram(body: any): MensajeInstagram[] {
  if (body?.object !== 'instagram') return [];
  const salida: MensajeInstagram[] = [];
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
        canal: 'INSTAGRAM',
        instagramAccountId: cuenta,
        from: destinoInstagram(remitente),
        messageId: `ig:${m.mid}`,
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
