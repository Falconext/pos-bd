/**
 * Utilidades para stock decimal (venta por peso).
 * Los campos de stock/cantidad en Prisma son Decimal; estos helpers
 * los convierten a number para operar y redondean a 3 decimales.
 */

/** Convierte Decimal | number | string | null | undefined a number seguro. */
export const num = (v: any): number => (v == null ? 0 : Number(v));

/** Redondea a 3 decimales (evita drift de float en stock por peso). */
export const round3 = (n: number): number =>
  Math.round((num(n) + Number.EPSILON) * 1000) / 1000;
