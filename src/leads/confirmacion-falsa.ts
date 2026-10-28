/**
 * El asesor no puede decir que el pedido quedó registrado si no lo está.
 *
 * Pasó en la prueba del 19-10: `registrar_pedido` contestó que faltaba la
 * sede de Shalom y el modelo igual escribió "Tu pedido ha quedado registrado"
 * y "He recibido tu adelanto". El cliente se queda esperando un paquete que
 * nadie va a despachar, y nadie del equipo se entera porque no hay pedido.
 *
 * Es una regla de código y no del prompt por la misma razón que el descargo
 * legal: el modelo la incumple justo en el mensaje que importa.
 */
import type { LlamadaHerramienta } from '../gemini/gemini.service';
import {
  HERRAMIENTA_AGENDAR_VISITA,
  HERRAMIENTA_AVISAR_VISITA,
  HERRAMIENTA_REGISTRAR_PEDIDO,
} from './leads-herramientas';

const AFIRMA_REGISTRO =
  /(qued[oó]|ha quedado|est[aá]|fue|hemos|he|se ha)\s+(\S+\s+){0,3}(registrad|agendad|confirmad)|pedido\s+(registrado|agendado|confirmado)|se ha agendado/i;

/** ¿El texto le asegura al cliente que su pedido ya está registrado? */
export function afirmaPedidoRegistrado(texto: string): boolean {
  return AFIRMA_REGISTRO.test(texto);
}

/**
 * Si la respuesta afirma un registro que no ocurrió, la reemplaza por el
 * pedido de lo que falta. Si no, la deja igual.
 */
export function sinConfirmacionFalsa(
  respuesta: string,
  llamadas: LlamadaHerramienta[],
  pedidoRegistrado: boolean,
): string {
  if (pedidoRegistrado || !afirmaPedidoRegistrado(respuesta)) return respuesta;
  // "Tu visita quedó agendada para el martes" es verdad si en este turno se
  // registró la visita (QA 26-10: la guardia la cambiaba por "todavía no pude
  // registrar tu pedido" a un cliente que solo iba a conocer la tienda).
  const visitaAgendada = llamadas.some(
    (ll) =>
      ll.nombre === HERRAMIENTA_AGENDAR_VISITA &&
      (ll.resultado as { registrada?: unknown } | undefined)?.registrada === true,
  );
  if (visitaAgendada && !/\bpedido/i.test(respuesta)) return respuesta;

  const intento = [...llamadas]
    .reverse()
    .find((ll) => ll.nombre === HERRAMIENTA_REGISTRAR_PEDIDO);
  const r = (intento?.resultado ?? {}) as { falta?: unknown; error?: unknown };
  const falta = (Array.isArray(r.falta) ? r.falta : r.falta ? [r.falta] : [])
    .map(String)
    .filter(Boolean);

  if (falta.length) {
    return `Para dejar tu pedido registrado solo me falta ${unir(falta)}. ¿Me lo confirmas, por favor?`;
  }
  // Sin una lista de faltantes no se sabe qué pedir; lo honesto es no
  // confirmar y no prometer un mensaje que nadie va a mandar.
  return 'Todavía no pude dejar registrado tu pedido. ¿Me confirmas tus datos de entrega para intentarlo de nuevo?';
}

const AFIRMA_CANCELACION =
  /(qued[oó]|queda|ha quedado|est[aá]|fue|he|hemos|se ha)\s+(\S+\s+){0,2}(cancelad|anulad)|pedido\s+(cancelado|anulado)/i;

/** ¿El texto le asegura al cliente que su pedido quedó cancelado? */
export function afirmaCancelacion(texto: string): boolean {
  return AFIRMA_CANCELACION.test(texto);
}

/**
 * QA 23-10 (Krezka): en 10 de 13 chats que terminaban en ventas el modelo
 * escribió "Alguien de nuestro equipo de ventas se contactará contigo" sin
 * llamar a derivar_a_asesor. Nadie recibía aviso y la IA seguía contestando:
 * el cliente esperaba a una persona que no sabía que la esperaban.
 *
 * Solo cuenta lo que se afirma, no lo que se ofrece: "¿quieres que alguien de
 * ventas se comunique contigo?" no es una derivación.
 */
const AFIRMA_DERIVACION =
  /\b(se|te)\s+(contactar|comunicar|escribir)[aá]n?(?![a-záéíóúñ])|\bya\s+(le\s+|les\s+)?(inform|avis)[eé](?![a-záéíóúñ])|\bte\s+(paso|derivo|comunico|transfiero)\s+con\b/i;

// Y que hable de alguien del equipo: "Diego te escribirá" en capacitación es
// un contacto que el cliente ya tiene, no un chat que se pausa.
const QUIEN_ATIENDE =
  /\b(alguien|equipo|ventas|asesor|asesora|persona|ejecutiv[oa]|encargad[oa])\b/i;

/** ¿El texto le asegura al cliente que ya lo pasaron con una persona? */
export function afirmaDerivacion(
  texto: string,
  mensajeDerivacion?: string | null,
): boolean {
  const plano = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const propio = plano(mensajeDerivacion ?? '');
  if (propio && plano(texto).includes(propio)) return true;
  // Frase por frase, para que una pregunta no cuente como afirmación.
  return texto
    .split(/(?<=[.!?¡¿\n])\s*/)
    .filter((f) => !f.trim().endsWith('?'))
    .some((f) => AFIRMA_DERIVACION.test(f) && QUIEN_ATIENDE.test(f));
}

/**
 * Parte el texto en frases sin cortar en "2 p. m." ni en "Av. Emancipación".
 * QA 28-10: al sacar una frase cortada en "p." quedaba "m., ¿podrías…".
 * Unir las frases devuelve el texto tal cual.
 */
// El punto de adentro de "p. m." nunca corta; el del final corta solo si lo
// sigue una mayúscula o "¿" ("…a las 2 p. m. ¿Me das tu nombre?").
const ABREVIATURA =
  /\b(?:[ap]\.\s?m(?:\.(?!\s+[¿¡A-ZÁÉÍÓÚÑ]))?|(?:Av|Jr|Sr|Sra|Srta|Dr|Dra|Mz|Lt|Nro|Urb|Prol|Psje)\.)/g;

function frasesDe(texto: string): string[] {
  const guardadas: string[] = [];
  const protegido = texto.replace(ABREVIATURA, (m) => {
    guardadas.push(m);
    return `\u0000${guardadas.length - 1}\u0000`;
  });
  return protegido
    // Se corta DESPUÉS de . ! ? y no en "¿": "Para dejarlo listo, ¿me das tu
    // nombre?" es una sola frase, y es pregunta (QA 28-10 cortaba en el "¿").
    .split(/(?<=[.!?\n])/)
    .map((f) => f.replace(/\u0000(\d+)\u0000/g, (_, i) => guardadas[Number(i)]));
}

/**
 * QA 27-10 (Hierba Sana): "quiero 2, paso a recogerlo mañana a las 11" → el
 * modelo cotizó y escribió "Ya dejé avisada la tienda" sin llamar a
 * avisar_visita_tienda. La tienda no se entera, no hay visita en la lista y
 * al cliente no le llega cómo llegar.
 */
const AFIRMA_AVISO_TIENDA =
  /\b(dej[eé]|he dejado|hemos dejado|qued[oó]|queda|ya est[aá])\s+(\S+\s+){0,2}avisad[ao]s?\b|\b(avisé|hemos avisado|he avisado)\s+(\S+\s+){0,2}(a\s+)?la tienda\b/i;

/** Frase por frase: una pregunta ("¿quieres que avise a la tienda?") no cuenta. */
const esAfirmacionDeAviso = (frase: string) => !frase.trim().endsWith('?') && AFIRMA_AVISO_TIENDA.test(frase);

export function afirmaAvisoATienda(texto: string): boolean {
  return frasesDe(texto).some(esAfirmacionDeAviso);
}

/**
 * Si dice que avisó a la tienda sin haberlo hecho, se saca esa frase (la
 * cotización que la acompaña se queda) y se pide la confirmación que falta.
 */
export function sinAvisoInventado(
  respuesta: string,
  llamadas: LlamadaHerramienta[],
  tiendaYaAvisada: boolean,
): string {
  if (tiendaYaAvisada || !afirmaAvisoATienda(respuesta)) return respuesta;
  const avisoEsteTurno = llamadas.some(
    (ll) =>
      ll.nombre === HERRAMIENTA_AVISAR_VISITA &&
      (ll.resultado as { avisado?: unknown } | undefined)?.avisado === true,
  );
  if (avisoEsteTurno) return respuesta;
  const frases = frasesDe(respuesta);
  const limpias = frases.filter((f) => !esAfirmacionDeAviso(f)).join('').trim();
  return `${limpias}\n\n¿Te lo dejo separado para que pases a recogerlo? Confírmame y aviso a la tienda.`;
}

const AFIRMA_PRODUCTOS_LISTOS =
  /\b(tener|tendremos|tenemos|tengamos|dejar|dejamos|dejo|dej[eé]|queda|quedan|qued[oó]|quedaron|estar[aá]n?|est[aá]n?)\s+(\S+\s+){0,3}(list[oa]s?|preparad[oa]s?|separad[oa]s?|reservad[oa]s?|apartad[oa]s?)\b/i;

// "Tu cotización está lista" es verdad aunque no haya pedido.
const esAfirmacionDeListos = (frase: string) =>
  !frase.trim().endsWith('?') &&
  !/cotizaci[oó]n/i.test(frase) &&
  AFIRMA_PRODUCTOS_LISTOS.test(frase);

/**
 * "Ya quedó avisada la tienda para tener listas tus cápsulas" sin pedido
 * registrado (Hierba Sana, 28-10): nadie separó nada y el cliente llega el
 * viernes confiado. Sin nota de venta no hay productos separados, así que
 * esa frase se saca y se le dice qué falta para separarlos.
 */
export function sinProductosListosInventado(
  respuesta: string,
  pedidoRegistrado: boolean,
): string {
  if (pedidoRegistrado) return respuesta;
  const frases = frasesDe(respuesta);
  if (!frases.some(esAfirmacionDeListos)) return respuesta;
  const limpias = frases.filter((f) => !esAfirmacionDeListos(f)).join('').trim();
  return `${limpias}\n\nOjo: todavía no tengo tus productos separados. Si quieres que te los deje listos para recoger, confírmame tu nombre completo y registro tu pedido.`;
}

function unir(partes: string[]): string {
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
}

const AFIRMA_PAGO =
  /(he|hemos)\s+(verificado|confirmado|validado|recibido)\s+(\S+\s+){0,2}(pago|yape|plin|transferencia|abono|adelanto)|verifiqu[eé]\s+(\S+\s+){0,2}(pago|yape|plin|transferencia|abono|adelanto)|(pago|yape|plin|transferencia|abono|adelanto)\s+(verificado|confirmado|validado|recibido)|recib[ií](mos)?\s+(tu|el|su)\s+(pago|yape|plin|transferencia|abono|adelanto)/i;

/** ¿El texto le asegura al cliente que su pago ya está verificado o recibido? */
export function afirmaPagoVerificado(texto: string): boolean {
  return AFIRMA_PAGO.test(texto);
}

/**
 * El asesor no puede dar por verificado un pago que nadie leyó.
 *
 * QA 21-10: el cliente mandó una imagen que no se pudo leer y escribió "ya
 * yapee los 77"; el modelo contestó "He verificado tu pago de S/ 77.00" y el
 * pedido quedó "completamente confirmado". Con una captura borrosa o de otro
 * monto pasa igual. Si no hay ningún voucher leído para este pedido, lo
 * honesto es decir que una persona lo revisa.
 */
export function sinPagoInventado(respuesta: string, hayVoucherLeido: boolean): string {
  if (hayVoucherLeido || !afirmaPagoVerificado(respuesta)) return respuesta;
  return 'Gracias, recibí tu constancia. Un asesor del equipo la revisa y te confirma el pago en un momento.';
}
