/**
 * Reprecio masivo de una lista de precios.
 *
 * El caso: al proveedor le suben los precios y el empresario tiene que mover
 * 200 productos. Hoy entra producto por producto; esto lo hace de una pasada.
 *
 * Todo el módulo trabaja con PRECIOS DE VENTA (con IGV), que es como el
 * empresario los piensa y como se escriben en la ficha. El costo se guarda
 * neto, así que se le re-agrega el IGV antes de comparar: restar un costo sin
 * IGV de un precio con IGV infla la utilidad ~18% y es el error que hace que
 * alguien crea que gana cuando está perdiendo.
 */

export type OperacionReprecio = 'AUMENTAR' | 'DISMINUIR' | 'REEMPLAZAR';
export type ModoReprecio = 'MONTO' | 'PORCENTAJE';

/** Catálogo 07 de SUNAT: solo "10..17" son gravadas. */
export function esGravado(tipoAfectacionIGV?: string | null): boolean {
  return /^1\d$/.test(String(tipoAfectacionIGV ?? ''));
}

/**
 * Costo que el negocio realmente paga, con IGV.
 *
 * `Producto.costoPromedio` se almacena NETO. Lo que el empresario reconoce como
 * "me costó 55" es este número, no el neto.
 */
export function costoConIgv(
  costoNeto: number | string | null | undefined,
  gravado: boolean,
  igvPorcentaje: number | string = 18,
): number {
  const neto = Number(costoNeto ?? 0);
  if (!Number.isFinite(neto) || neto <= 0) return 0;
  const tasa = gravado ? Number(igvPorcentaje ?? 18) / 100 : 0;
  return redondear(neto * (1 + tasa));
}

/**
 * Utilidad sobre el COSTO, en porcentaje: cuánto se le gana a lo que se pagó.
 *
 * Es la misma definición que usa Casa Market en su pantalla de reprecio
 * (verificado contra sus cifras: 80 sobre un costo de 55 da 45.45%), y NO la
 * misma que el margen de la ficha de producto, que va sobre el precio de venta.
 * Son dos números distintos: con precio 80 y costo 55, este da 45.45% y aquel
 * 31.25%. Mezclarlos es la forma de fijar precios por debajo de lo que se cree.
 *
 * Sin costo cargado no hay utilidad que calcular: devuelve null en vez de un 0
 * o un infinito que se vería como un dato real.
 */
export function utilidadSobreCosto(
  precioVenta: number,
  costoConIgvValor: number,
): number | null {
  if (!Number.isFinite(costoConIgvValor) || costoConIgvValor <= 0) return null;
  if (!Number.isFinite(precioVenta)) return null;
  return redondear(((precioVenta - costoConIgvValor) / costoConIgvValor) * 100);
}

/** Precio de venta que deja exactamente esa utilidad sobre el costo. */
export function precioDesdeUtilidad(
  costoConIgvValor: number,
  utilidadPorcentaje: number,
): number | null {
  if (!Number.isFinite(costoConIgvValor) || costoConIgvValor <= 0) return null;
  const u = Number(utilidadPorcentaje);
  if (!Number.isFinite(u)) return null;
  return redondear(costoConIgvValor * (1 + u / 100));
}

/**
 * Precio nuevo según la operación elegida.
 *
 * `REEMPLAZAR` + `PORCENTAJE` no es "poner el precio en N%": es fijar la
 * UTILIDAD en N%, que es para lo que sirve el botón "calcular por último
 * costo". Por eso necesita el costo; sin costo no se puede y devuelve null.
 */
export function calcularPrecioNuevo(opts: {
  precioActual: number;
  costoConIgv: number;
  operacion: OperacionReprecio;
  modo: ModoReprecio;
  valor: number;
}): number | null {
  const { precioActual, operacion, modo } = opts;
  const valor = Number(opts.valor);
  if (!Number.isFinite(valor)) return null;

  if (operacion === 'REEMPLAZAR') {
    return modo === 'MONTO'
      ? sanear(valor)
      : precioDesdeUtilidad(opts.costoConIgv, valor);
  }

  const actual = Number(precioActual);
  if (!Number.isFinite(actual)) return null;
  const signo = operacion === 'AUMENTAR' ? 1 : -1;

  return modo === 'MONTO'
    ? sanear(actual + signo * valor)
    : sanear(actual * (1 + (signo * valor) / 100));
}

/**
 * Un reprecio no puede dejar un precio en cero o negativo: eso sería regalar el
 * producto sin que nadie lo decidiera. Se devuelve null y la fila se salta.
 */
function sanear(precio: number): number | null {
  const p = redondear(precio);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** Dos decimales: es dinero. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
