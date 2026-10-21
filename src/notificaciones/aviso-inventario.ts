/**
 * Avisos de la campana "Productos Agotados" / "Stock Bajo": la parte que no
 * toca la base.
 *
 * ZABDI MULTIMARCAS (empresa 87, 2026-10-21): "me sale que mis productos están
 * agotados cuando no lo están, porque no he vendido esos productos. Me sale
 * todos los días". Eran variantes (un aroma, un tono) registradas con 0 que
 * nunca tuvieron stock, y la revisión de las 8 a. m. repetía la misma lista
 * cada mañana, dos veces: la general y la de su única sede.
 */

/** Cuánto vale un aviso ya dado: pasado esto, si sigue igual, se recuerda. */
export const DIAS_RECORDATORIO = 7;

export interface ProductoAvisable {
  id: number;
  sedeId?: number | null;
}

/** Identifica el producto en su sede dentro de `metaData.claves`. */
export function claveAviso(p: ProductoAvisable): string {
  return `${p.id}-${p.sedeId ?? 'g'}`;
}

/** Las claves que ya se avisaron, leídas del metaData de las notificaciones. */
export function clavesAvisadas(metaDatas: unknown[]): Set<string> {
  const claves = new Set<string>();
  for (const m of metaDatas) {
    const lista = (m as { claves?: unknown } | null)?.claves;
    if (!Array.isArray(lista)) continue;
    for (const c of lista) if (typeof c === 'string') claves.add(c);
  }
  return claves;
}

/** Lo que todavía no se le avisó: la revisión diaria no repite la lista. */
export function porAvisar<T extends ProductoAvisable>(
  productos: T[],
  yaAvisadas: Set<string>,
): T[] {
  return productos.filter((p) => !yaAvisadas.has(claveAviso(p)));
}
