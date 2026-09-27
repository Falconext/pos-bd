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

/**
 * Cliente de Prisma o transacción; solo se usan estas dos tablas.
 */
type ClienteCosto = {
  productoStock: {
    findMany: (args: any) => Promise<any[]>;
    updateMany: (args: any) => Promise<any>;
  };
  producto: { update: (args: any) => Promise<any> };
};

/**
 * Deja el costo global del producto en línea con el de sus sedes, y de paso
 * cierra la circularidad que hace falta cerrar para que esto funcione.
 *
 * El problema: una sede en NULL "vale el global", pero el global se deriva de
 * las sedes. Si quedan NULLs en la mezcla, cada recálculo las revalúa con el
 * global recién calculado y el número se va corriendo solo — S/36.62 se
 * convertía en S/41.99 en seis movimientos, sin que entrara mercadería.
 *
 * Por eso, en cuanto UNA sede estrena costo propio, las demás se fijan en el
 * global vigente en ese instante. No cambia lo que se ve —era justamente el
 * valor que estaban mostrando— y a partir de ahí cada sede solo se mueve por
 * sus propios movimientos. La migración sigue siendo perezosa, pero por
 * producto y no por sede.
 */
export const alinearCostoGlobal = async (
  cliente: ClienteCosto,
  productoId: number,
  costoGlobalActual: unknown,
): Promise<void> => {
  let filas = await cliente.productoStock.findMany({
    where: { productoId },
    select: { stock: true, costoPromedio: true },
  });

  const algunaTieneCosto = filas.some((f) => f.costoPromedio != null);
  // Solo las sedes que TIENEN mercadería: una en cero no aporta valor y no
  // entra en la circularidad, así que se la deja en NULL. Congelarle un costo
  // sería inventarle un dato que nadie le puso.
  const faltanCostos = filas.some(
    (f) => f.costoPromedio == null && Number(f.stock) !== 0,
  );
  if (algunaTieneCosto && faltanCostos) {
    const congelado = costoDeSede(null, costoGlobalActual);
    await cliente.productoStock.updateMany({
      where: { productoId, costoPromedio: null, NOT: { stock: 0 } },
      data: { costoPromedio: congelado },
    });
    filas = filas.map((f) =>
      f.costoPromedio == null && Number(f.stock) !== 0
        ? { ...f, costoPromedio: congelado }
        : f,
    );
  }

  const costoPromedio = promedioDesdeSedes(filas, costoGlobalActual);
  if (costoPromedio != null) {
    await cliente.producto.update({
      where: { id: productoId },
      data: { costoPromedio },
    });
  }
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
