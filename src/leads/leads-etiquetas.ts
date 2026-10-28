/**
 * Etiquetas de contactos — reglas puras.
 *
 * Las etiquetas son lo que después permite elegir a quién mandarle un envío
 * masivo. Por eso lo que importa acá es que no se dupliquen: si "Mayorista",
 * "mayorista" y "mayorista " son tres etiquetas distintas, el segmento
 * "mayoristas" deja afuera a dos tercios de la gente sin que nadie lo note.
 */

/** Claves de la paleta del panel. El color se elige de acá, no se escribe. */
export const COLORES_ETIQUETA = [
  'gris',
  'violeta',
  'azul',
  'verde',
  'amarillo',
  'naranja',
  'rojo',
  'rosa',
] as const;

export type ColorEtiqueta = (typeof COLORES_ETIQUETA)[number];

export const LARGO_MAXIMO_ETIQUETA = 40;

/**
 * Tope por empresa. Con cientos de etiquetas el selector deja de servir y lo
 * que se arma es un segundo buscador; para eso ya están las notas del chat.
 */
export const MAXIMO_ETIQUETAS_POR_EMPRESA = 100;

/**
 * El nombre tal como se guarda: sin espacios de más y con largo acotado.
 * Null si no queda nada.
 */
export function normalizarNombreEtiqueta(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio) return null;
  return limpio.slice(0, LARGO_MAXIMO_ETIQUETA).trim();
}

/** La forma de comparar dos nombres: sin mayúsculas ni tildes. */
export function claveEtiqueta(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Un color de la paleta; cualquier otra cosa cae al gris. */
export function colorValido(color: unknown): ColorEtiqueta {
  return COLORES_ETIQUETA.includes(color as ColorEtiqueta)
    ? (color as ColorEtiqueta)
    : 'gris';
}

/**
 * La etiqueta existente con el mismo nombre (ignorando mayúsculas y tildes),
 * para reutilizarla en vez de crear un duplicado. `exceptoId` sirve al
 * renombrar: la propia etiqueta no cuenta como choque.
 */
export function buscarMismoNombre<T extends { id: number; nombre: string }>(
  existentes: T[],
  nombre: string,
  exceptoId?: number,
): T | undefined {
  const clave = claveEtiqueta(nombre);
  return existentes.find(
    (e) => e.id !== exceptoId && claveEtiqueta(e.nombre) === clave,
  );
}
