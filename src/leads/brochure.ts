/**
 * ¿Toca mandarle el brochure al cliente?
 *
 * Antes bastaba con que el mensaje dijera "más información": es justo el texto
 * que trae el botón de los anuncios ("Hola, quiero más información"), así que
 * todo el que entraba por un anuncio recibía de entrada el saludo, el video y
 * un PDF de 23 MB antes de contestar la única pregunta que importaba (Krezka,
 * 22-10). Tampoco servía "envíame": saltaba con "envíame la cuenta".
 *
 * Ahora:
 *  - Si lo pide por su nombre (brochure, folleto, catálogo, PDF,
 *    presentación), se manda en cualquier momento.
 *  - Si solo pide "más información", se manda cuando ya está conversando,
 *    nunca con su primer mensaje.
 */

const PIDE_EL_ARCHIVO =
  /\b(brochure|brochur|folleto|catalogo|pdf|presentacion)\b/;

const PIDE_MAS_INFO =
  /\b(mas info|mas informacion|informacion completa|mandame info|mandame la info|mandame informacion)\b/;

function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function pideBrochure(texto: string, esSuPrimerMensaje: boolean): boolean {
  const t = normalizar(texto || '');
  if (PIDE_EL_ARCHIVO.test(t)) return true;
  return !esSuPrimerMensaje && PIDE_MAS_INFO.test(t);
}
