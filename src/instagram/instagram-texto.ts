/**
 * Lo que cambia al escribir por Instagram en vez de WhatsApp.
 *
 * Puro: se prueba sin red.
 */

/** Prefijo con que se guarda al cliente de Instagram en `telefonoProspecto`. */
export const PREFIJO_INSTAGRAM = 'ig:';

export const esDestinoInstagram = (destino: string | null | undefined): boolean =>
  String(destino ?? '').startsWith(PREFIJO_INSTAGRAM);

/** El id del usuario de Instagram (IGSID) sin el prefijo. */
export const idInstagram = (destino: string): string => String(destino).slice(PREFIJO_INSTAGRAM.length);

export const destinoInstagram = (igsid: string): string => `${PREFIJO_INSTAGRAM}${igsid}`;

/**
 * Instagram no interpreta el formato de WhatsApp: "*Av. Emancipación*" llega
 * con los asteriscos a la vista. Se quitan las marcas y queda el texto.
 */
export function enTextoPlano(texto: string): string {
  return String(texto ?? '')
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '$1')
    .replace(/(^|[\s(¡¿"'])\*(?=\S)([^*\n]+?)(?<=\S)\*(?=$|[\s).,;:!?"'])/gm, '$1$2')
    .replace(/(^|[\s(¡¿"'])_(?=\S)([^_\n]+?)(?<=\S)_(?=$|[\s).,;:!?"'])/gm, '$1$2')
    .replace(/(^|[\s(¡¿"'])~(?=\S)([^~\n]+?)(?<=\S)~(?=$|[\s).,;:!?"'])/gm, '$1$2')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
}

/** Instagram acepta hasta 1000 bytes (UTF-8) por mensaje. */
export const LIMITE_BYTES_INSTAGRAM = 1000;

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

/**
 * Parte un texto largo en mensajes de hasta `limite` bytes, cortando por
 * párrafo, después por línea y después por palabra. Una palabra que sola ya no
 * entra (un link enorme) se corta por caracteres: mejor partida que perdida.
 */
export function partirMensaje(texto: string, limite = LIMITE_BYTES_INSTAGRAM): string[] {
  const limpio = String(texto ?? '').trim();
  if (!limpio) return [];
  if (bytes(limpio) <= limite) return [limpio];

  const partes: string[] = [];
  let actual = '';
  const empujar = () => {
    if (actual.trim()) partes.push(actual.trim());
    actual = '';
  };
  const agregar = (pieza: string, sep: string) => {
    const candidato = actual ? `${actual}${sep}${pieza}` : pieza;
    if (bytes(candidato) <= limite) {
      actual = candidato;
      return;
    }
    empujar();
    if (bytes(pieza) <= limite) {
      actual = pieza;
      return;
    }
    // La pieza sola no entra: se baja un nivel.
    if (sep === '\n\n') return pieza.split('\n').forEach((l) => agregar(l, '\n'));
    if (sep === '\n') return pieza.split(' ').forEach((w) => agregar(w, ' '));
    let resto = pieza;
    while (bytes(resto) > limite) {
      let n = limite;
      while (bytes(resto.slice(0, n)) > limite) n--;
      partes.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    actual = resto;
  };
  limpio.split(/\n{2,}/).forEach((p) => agregar(p, '\n\n'));
  empujar();
  return partes;
}
