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
import { HERRAMIENTA_REGISTRAR_PEDIDO } from './leads-herramientas';

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
