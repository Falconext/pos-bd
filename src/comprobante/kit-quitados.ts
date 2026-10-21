/**
 * Kit vendido como una línea al que el cliente le pidió quitar algo
 * (florería: "el Detalle Te Amo pero sin chocolates"). La línea guarda los
 * productos quitados en `DetalleComprobante.kitQuitados` y el stock se
 * descuenta / repone solo de lo que de verdad se llevó.
 *
 * Sin Prisma, para poder probarlo entero.
 */

/** Ids de producto quitados, limpios y sin repetir. Vacío = kit completo. */
export function normalizarKitQuitados(valor: unknown): number[] {
  if (!Array.isArray(valor)) return [];
  const ids = valor.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

/** Componentes que quedan en el kit después de quitar los elegidos. */
export function componentesQueQuedan<T extends { productoId: number }>(
  items: T[],
  quitados: unknown,
): T[] {
  const fuera = new Set(normalizarKitQuitados(quitados));
  if (!fuera.size) return items;
  return items.filter((it) => !fuera.has(Number(it.productoId)));
}
