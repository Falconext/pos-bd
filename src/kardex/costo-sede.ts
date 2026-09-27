/**
 * Costeo promedio ponderado, por sede.
 *
 * Durante la migración conviven dos costos para el mismo producto: el histórico
 * global en `Producto.costoPromedio` y el de cada local en
 * `ProductoStock.costoPromedio`. Una sede en NULL todavía no registró ningún
 * ingreso desde que existe la columna, y mientras tanto vale el global.
 *
 * Toda lectura de costo pasa por `costoDeSede`, y todo cálculo por
 * `promedioTrasIngreso`. El día que el costo global deje de escribirse habrá un
 * solo lugar que tocar, y hoy garantiza que las dos capas usen la misma regla.
 */

/** El costo que corresponde a un producto en una sede, con respaldo al global. */
export const costoDeSede = (
  costoSede: unknown,
  costoGlobal: unknown,
): number => {
  if (costoSede != null) {
    const propio = Number(costoSede);
    if (Number.isFinite(propio)) return propio;
  }
  const global = Number(costoGlobal);
  return Number.isFinite(global) ? global : 0;
};

/**
 * Promedio ponderado después de un ingreso, o null si no hay stock sobre el
 * cual costear.
 *
 * `stockDespues` es el stock YA actualizado; lo que había antes es la
 * diferencia con la cantidad que entró.
 *
 * Si antes no había mercadería —producto nuevo, o stock en negativo por
 * sobreventa— el costo del ingreso ES el promedio: no hay nada con qué
 * promediarlo. Sin esa regla, un stock previo negativo mete un valor negativo
 * en la ponderación y el resultado sale por encima del precio de compra, o
 * directamente negativo.
 */
/**
 * El costo global del producto, derivado de lo que vale cada sede.
 *
 * No se lleva como un promedio aparte porque en cuanto las sedes tienen costos
 * distintos, un promedio propio se despega de la realidad: vender en la sede
 * barata baja el inventario global por el promedio y no por lo que esa sede
 * pagó, y el valorizado de la empresa deja de ser la suma de sus locales.
 *
 * Derivarlo mantiene la identidad exacta —stock global × costo global = suma de
 * (stock × costo) por sede— que es lo que hace que los dos reportes cuadren.
 * Con una sola sede da exactamente lo mismo que antes.
 *
 * Devuelve null si no hay stock sobre el cual promediar.
 */
export const promedioDesdeSedes = (
  filas: Array<{ stock: unknown; costoPromedio: unknown }>,
  costoGlobalActual: unknown,
): number | null => {
  let stockTotal = 0;
  let valorTotal = 0;
  for (const fila of filas) {
    const stock = Number(fila.stock);
    if (!Number.isFinite(stock)) continue;
    stockTotal += stock;
    valorTotal += stock * costoDeSede(fila.costoPromedio, costoGlobalActual);
  }
  if (!(stockTotal > 0)) return null;
  return valorTotal / stockTotal;
};

export const promedioTrasIngreso = (
  stockDespues: number,
  cantidad: number,
  costoIngreso: number,
  costoAnterior: number,
): number | null => {
  if (!(stockDespues > 0)) return null;
  const stockAntes = stockDespues - cantidad;
  return stockAntes > 0
    ? (stockAntes * costoAnterior + cantidad * costoIngreso) / stockDespues
    : costoIngreso;
};
