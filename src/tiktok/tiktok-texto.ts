/**
 * Reglas puras de las respuestas a comentarios de TikTok.
 *
 * TikTok corta la respuesta a 150 caracteres y la muestra tal cual: sin
 * negritas de WhatsApp, sin saltos de línea. Lo que no entra se pierde, así que
 * se corta acá, en una palabra, y no allá a la mitad.
 */

export const MAX_RESPUESTA_TIKTOK = 150;

/** Texto listo para publicar: una línea, sin formato, a lo más 150 caracteres. */
export function respuestaParaTiktok(texto: string, max = MAX_RESPUESTA_TIKTOK): string {
  const limpio = String(texto ?? '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (Array.from(limpio).length <= max) return limpio;
  const cortado = Array.from(limpio).slice(0, max - 1).join('');
  const ultimoEspacio = cortado.lastIndexOf(' ');
  return `${(ultimoEspacio > max * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).replace(/[\s,;:.-]+$/, '')}…`;
}

const normalizar = (t: string) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * ¿Hay que responder este comentario? Con palabras clave (separadas por coma)
 * solo los que mencionan alguna; sin palabras, todos los que dicen algo.
 */
export function comentarioTiktokCalza(texto: string, clave?: string | null): boolean {
  const t = normalizar(texto).trim();
  if (!t) return false;
  const palabras = String(clave ?? '')
    .split(',')
    .map((p) => normalizar(p).trim())
    .filter(Boolean);
  if (!palabras.length) return true;
  return palabras.some((p) => t.includes(p));
}

/** Palabras clave limpias para guardar: "precio,  info ," → "precio, info". */
export function limpiarClaves(clave?: string | null): string | null {
  const limpia = String(clave ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');
  return limpia || null;
}
