/**
 * Mensajes que el negocio escribe desde su celular (coexistencia).
 *
 * Un número conectado en coexistencia sigue funcionando en la app WhatsApp
 * Business del celular y en la API al mismo tiempo. Lo que el dueño contesta
 * desde la app NO pasa por nosotros: Meta nos lo avisa después con el webhook
 * `smb_message_echoes`. Hay que leerlo por dos razones:
 *  1. Que la bandeja muestre la conversación completa, no solo la mitad.
 *  2. Que la IA se calle en ese chat: si el dueño ya está atendiendo y la IA
 *     sigue contestando, el cliente recibe dos respuestas que no se hablan.
 *
 * Los números conectados de la forma normal (solo API) nunca reciben este
 * webhook, así que nada de esto corre para ellos.
 */

export const JOB_ECO_VENDEDOR = 'eco-vendedor';

export interface EcoVendedor {
  /** El número de la empresa (phone_number_id) que mandó el mensaje. */
  phoneNumberId: string;
  /** El cliente al que le escribió, solo dígitos (como llega `from` en los entrantes). */
  to: string;
  messageId: string;
  /** Texto para la bandeja y para la IA, que solo lee texto. */
  texto: string;
  timestamp?: string;
}

/** Texto de un eco, o `null` si no es un mensaje (editar, borrar, tipos raros). */
export function textoDeEco(eco: any): string | null {
  switch (eco?.type) {
    case 'text':
      return eco.text?.body ?? '';
    case 'image':
      return eco.image?.caption?.trim() ? `[Imagen] ${eco.image.caption.trim()}` : '[Imagen]';
    case 'video':
      return eco.video?.caption?.trim() ? `[Video] ${eco.video.caption.trim()}` : '[Video]';
    case 'document':
      return `[Documento${eco.document?.filename ? `: ${eco.document.filename}` : ''}]`;
    case 'audio':
      return '[Nota de voz]';
    case 'sticker':
      return '[Sticker]';
    case 'location':
      return '[Ubicación]';
    default:
      // `edit` y `revoke` cambian un mensaje que ya está; no son uno nuevo.
      return null;
  }
}

/**
 * Los ecos de un `change` del webhook de WhatsApp. Vacío si el cambio no es
 * `smb_message_echoes` — que es lo que pasa con todos los números conectados
 * sin coexistencia.
 */
export function ecosDeCambio(change: any): EcoVendedor[] {
  if (change?.field !== 'smb_message_echoes') return [];
  const value = change.value ?? {};
  const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
  if (!phoneNumberId) return [];
  const ecos: EcoVendedor[] = [];
  for (const eco of value.message_echoes ?? []) {
    const texto = textoDeEco(eco);
    // Meta puede mandar el destino con "+": los entrantes llegan sin él y la
    // conversación se guarda con esos dígitos.
    const to = String(eco?.to ?? '').replace(/\D/g, '');
    if (texto === null || !to || !eco?.id) continue;
    ecos.push({ phoneNumberId, to, messageId: eco.id, texto, timestamp: eco.timestamp });
  }
  return ecos;
}
