/**
 * "Dirección" a secas es una PREGUNTA: ¿dónde queda la tienda?
 *
 * Hierba Sana, 21 y 23-10: el cliente escribió "Dirección" (primer mensaje de
 * la conversación) y el agente contestó "indícanos el distrito y la dirección
 * exacta…" —lo tomó como que el cliente iba a dar SU dirección y saltó a
 * agendar—. Otra vez, después de darle la dirección, el cliente escribió
 * "Gracias por dar tu dirección" y el agente le pidió los datos de envío.
 *
 * Con un mensaje tan corto el modelo no tiene de dónde agarrarse, así que se
 * lo decimos en el contexto del turno. Puro: se prueba sin modelo.
 */

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Habla de la ubicación del negocio (sin \b: "informaciondireccion" pasa). */
const MENCIONA_UBICACION =
  /direcci[o]n|ubicaci[o]n|ubicad[oa]s|donde (estan|quedan?|se encuentran|los encuentro|ubican)|como llego|tienda fisica|local fisico/;

/** El cliente está DANDO una dirección, no pidiéndola. */
const DA_DIRECCION =
  /\b(av|avenida|jr|jiron|calle|psje|pasaje|mz|lote|lt|urb|urbanizacion|asoc|aa\.?hh)\b\.?\s|\d{2,}|mi direccion|vivo en|mi casa|para (enviar|mandar) a/;

/** Nuestro último mensaje le pidió sus datos de entrega: ahí "dirección" puede ser su respuesta. */
const PIDIO_SUS_DATOS =
  /datos para agendar|tu direccion|la direccion exacta|direccion de entrega|direccion \(calle|donde (te|se lo|lo) (enviamos|entregamos|llevamos)/;

const AGRADECE = /\bgracias\b|\bgrax\b|\bmuchas gracias\b|\bagradezco\b/;

export type IntencionDireccion = 'pregunta' | 'agradece' | null;

export function intencionDireccion(loteCliente: string, ultimoNuestro?: string | null): IntencionDireccion {
  const t = normalizar(loteCliente).trim();
  if (!t || !MENCIONA_UBICACION.test(t)) return null;
  if (DA_DIRECCION.test(t)) return null;
  if (ultimoNuestro && PIDIO_SUS_DATOS.test(normalizar(ultimoNuestro))) return null;
  // Un párrafo largo es otra cosa (contó un caso, preguntó varias): que lo
  // resuelva el modelo con todo el contexto.
  if (t.split(/\s+/).length > 14) return null;
  if (AGRADECE.test(t) && !/\?/.test(t)) return 'agradece';
  return 'pregunta';
}

/** La línea que se suma al contexto del turno, o vacío. */
export function pistaDireccion(loteCliente: string, ultimoNuestro?: string | null): string {
  const intencion = intencionDireccion(loteCliente, ultimoNuestro);
  if (intencion === 'pregunta') {
    return 'EL CLIENTE PREGUNTA POR LA DIRECCIÓN DEL NEGOCIO: respóndele con la dirección de la tienda y cómo llegar (está en el contexto del negocio). NO es que te vaya a dar su dirección: no le pidas sus datos de envío en esta respuesta. Si además preguntó otra cosa en el mismo mensaje, respóndela también.';
  }
  if (intencion === 'agradece') {
    return 'EL CLIENTE AGRADECE LA DIRECCIÓN: lo más probable es que vaya a la tienda. Agradece en una línea y, si ya eligió un producto, ofrécele separárselo para recojo. No le pidas datos de envío.';
  }
  return '';
}
