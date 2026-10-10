/**
 * Lee el color y la talla de una variante para el Excel de inventario.
 *
 * COMERCIAL LINNA MODA exporta el catálogo "para poder filtrar y ver por talla
 * qué teníamos disponible". Una sola columna con "Negro / 36" no sirve para
 * eso: en Excel hay que filtrar por texto "contiene", y buscar 36 también
 * agarra 360 o un color que lleve ese número. Con columnas propias, el filtro
 * de Excel ofrece la lista de tallas y se elige.
 *
 * "Talla" y "Color" no son campos del sistema —el usuario bautiza sus
 * atributos— así que se buscan por nombre, igual que en el catálogo impreso.
 */

const ES_TALLA = /talla|size|medida/i;
const ES_COLOR = /color|colour/i;

type Atributos = Record<string, unknown> | null | undefined;

const texto = (valor: unknown): string => String(valor ?? '').trim();

/** El valor del primer atributo cuyo nombre coincida. */
const valorPorNombre = (atributos: Atributos, patron: RegExp): string => {
  for (const [nombre, valor] of Object.entries(atributos ?? {})) {
    if (patron.test(nombre)) return texto(valor);
  }
  return '';
};

export const tallaDe = (atributos: Atributos): string =>
  valorPorNombre(atributos, ES_TALLA);

export const colorDe = (atributos: Atributos): string =>
  valorPorNombre(atributos, ES_COLOR);

/**
 * Todos los valores juntos: "Negro / 36 / 7".
 *
 * Se mantiene además de las columnas sueltas porque un modelo puede tener un
 * tercer atributo (el taco, en calzado) que no merece columna propia pero sí
 * tiene que verse.
 */
export const varianteDe = (atributos: Atributos): string =>
  Object.values(atributos ?? {})
    .map(texto)
    .filter((valor) => valor !== '')
    .join(' / ');
