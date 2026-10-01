/**
 * Qué productos puede ofrecer el punto de venta, y cuáles solo se ven en el
 * inventario.
 *
 * El defecto que origina esto: "Desactivar" un producto NO lo sacaba del POS.
 * El listado traía ACTIVO e INACTIVO por igual, así que un empresario que
 * desactivaba un producto para dejar de venderlo lo seguía viendo —y
 * vendiendo— en /facturacion/nuevo. En producción había 193 productos
 * desactivados y 188 todavía se podían vender.
 *
 * Son dos listas distintas a propósito:
 *
 *   - El POS ofrece solo lo ACTIVO.
 *   - El Kardex muestra también lo INACTIVO, porque si no, el producto
 *     desaparecería del panel y no habría forma de volver a activarlo.
 *
 * PLACEHOLDER y ELIMINADO no entran a ninguna de las dos: el primero es un
 * registro a medio crear y el segundo ya no existe para el usuario.
 */

export type EstadoProducto = 'ACTIVO' | 'INACTIVO' | 'PLACEHOLDER' | 'ELIMINADO';

/** Lo que el punto de venta puede ofrecer. */
export const ESTADOS_VENDIBLES: EstadoProducto[] = ['ACTIVO'];

/** Lo que se ve en el inventario, incluido lo desactivado para reactivarlo. */
export const ESTADOS_EN_INVENTARIO: EstadoProducto[] = ['ACTIVO', 'INACTIVO'];

/**
 * Los estados que debe traer el listado.
 *
 * `soloVendibles` lo manda únicamente el POS; el Kardex no lo manda, y por eso
 * sigue viendo los desactivados.
 */
export const estadosAListar = (soloVendibles?: boolean): EstadoProducto[] =>
  soloVendibles ? ESTADOS_VENDIBLES : ESTADOS_EN_INVENTARIO;

/**
 * ¿Este producto se puede vender en esta sede?
 *
 * Tres candados independientes, y basta que uno esté cerrado:
 *   - el producto está desactivado (`estado`),
 *   - no está asignado a la sede (`visibleEnSede`),
 *   - o está asignado pero marcado como no vendible (`vendibleEnSede`).
 *
 * Los dos últimos se leen con `!== false` porque una fila de stock vieja puede
 * no tenerlos: ausente significa "sí", que es como se comportaba antes.
 */
export const sePuedeVender = (producto: {
  estado?: string | null;
  visibleEnSede?: boolean | null;
  vendibleEnSede?: boolean | null;
}): boolean =>
  producto?.estado === 'ACTIVO' &&
  producto?.visibleEnSede !== false &&
  producto?.vendibleEnSede !== false;
