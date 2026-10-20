/**
 * C4 — cuándo la IA se calla y cuándo vuelve.
 *
 * El problema que resuelve: antes, responder a mano apagaba el bot para
 * siempre en esa conversación. Nadie se acordaba de volver a encenderlo, así
 * que una sola intervención dejaba al cliente sin atención automática para
 * el resto de su vida.
 *
 * Ahora la pausa vence. Y hay dos pausas distintas que no hay que confundir:
 * la temporal (alguien tomó el chat un momento) y la definitiva (se derivó a
 * un humano, o el negocio apagó la IA a propósito).
 */

/** Cuánto se calla la IA cuando una persona responde. Lo pide el anexo. */
export const PAUSA_INTERVENCION_MS = 2 * 60 * 60 * 1000;

export interface EstadoPausa {
  botActivo: boolean;
  pausadoHasta: Date | null;
}

/**
 * ¿La IA tiene que quedarse callada ahora mismo?
 *
 * `pausadoHasta` en null con el bot apagado significa pausa SIN vencimiento:
 * es lo que deja una derivación a un humano o un apagado manual desde el
 * panel. Esa no se levanta sola — si se levantara, la IA se metería en medio
 * de un reclamo que ya está atendiendo una persona.
 */
export function estaPausado(
  estado: EstadoPausa | null | undefined,
  ahora: Date = new Date(),
): boolean {
  if (!estado || estado.botActivo) return false;
  if (!estado.pausadoHasta) return true;
  return estado.pausadoHasta.getTime() > ahora.getTime();
}

/** ¿Venció una pausa temporal y toca volver a encender la IA? */
export function debeReactivarse(
  estado: EstadoPausa | null | undefined,
  ahora: Date = new Date(),
): boolean {
  return (
    !!estado &&
    !estado.botActivo &&
    !!estado.pausadoHasta &&
    estado.pausadoHasta.getTime() <= ahora.getTime()
  );
}

/** Cuándo vence una pausa que empieza ahora. */
export function venceEn(
  ahora: Date = new Date(),
  duracionMs: number = PAUSA_INTERVENCION_MS,
): Date {
  return new Date(ahora.getTime() + duracionMs);
}

/**
 * Motivos por los que la IA deriva a una persona y deja de responder.
 * Salen del bloque DERIVAR del prompt del cliente.
 */
export const MOTIVOS_DERIVACION = [
  'mayorista',
  'reclamo',
  'seguimiento_de_pedido',
  'descuento_especial',
  'producto_no_disponible',
  // Cancelar un pedido con adelanto o que ya salió tiene costos: lo ve una persona.
  'cancelacion',
  'pide_hablar_con_persona',
] as const;

export type MotivoDerivacion = (typeof MOTIVOS_DERIVACION)[number];

/**
 * El comprobante de pago YA NO se deriva, y esto detecta cuando el modelo
 * igual lo intenta.
 *
 * Estuvo en la lista de arriba desde el principio, de cuando el voucher se
 * archivaba cerrado y una persona tenía que abrirlo. Desde que la IA lo lee
 * y le confirma al cliente el monto y la operación (ver
 * `registrarVoucherSiCorresponde`), derivar por eso es apagar el bot justo
 * cuando falta la mitad del trabajo: en Hierba Sana el pago llega ANTES de
 * los datos de envío, y el chat se queda sin quién los pida.
 *
 * No alcanza con sacarlo de la lista: el rechazo genérico le dice al modelo
 * "respóndelo tú" y eso, ante una captura de Yape, no le dice qué hacer. Con
 * esto se le da la instrucción que corresponde.
 *
 * Si un negocio necesita que una persona verifique cada pago, eso va en su
 * contexto —no en la lista de motivos, que es de todos.
 */
export function esMotivoDeComprobante(
  motivo: string | null | undefined,
): boolean {
  const n = String(motivo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /comprobante|voucher|constancia|captura.*pago|pago.*captura|yape|plin|transferencia/.test(
    n,
  );
}

/**
 * El motivo que trae el modelo, si es uno de los de verdad.
 *
 * La lista de arriba es cerrada a propósito: derivar apaga el bot sin
 * vencimiento, así que una derivación de más deja a un cliente esperando a
 * una persona que no sabe que lo esperan. El primer cliente en producción lo
 * vio con las preguntas por el registro sanitario: el modelo las pasaba al
 * supervisor en vez de contestarlas con la respuesta oficial que ya tenía.
 *
 * Se normaliza antes de comparar —tildes, mayúsculas, espacios por guiones
 * bajos— porque el modelo escribe "Pide hablar con persona" tan seguido como
 * el valor exacto, y rechazar eso sería rechazar una derivación buena.
 */
export function motivoDerivacionValido(
  motivo: string | null | undefined,
): MotivoDerivacion | null {
  const n = String(motivo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  if (!n) return null;
  return (
    MOTIVOS_DERIVACION.find((m) => m === n || n.includes(m)) ??
    // "pide hablar con una persona" / "quiere un asesor": el valor exacto no
    // llega, pero la intención es inequívoca y no conviene perderla.
    (/hablar_con|con_(una_)?persona|asesor_humano|supervisor/.test(n)
      ? 'pide_hablar_con_persona'
      : null)
  );
}
