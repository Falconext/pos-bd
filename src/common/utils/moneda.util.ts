/**
 * Utilidades de moneda para normalizar montos a Soles (PEN).
 *
 * Los comprobantes guardan `mtoImpVenta` en su moneda nativa (`tipoMoneda`).
 * Para las Facturas en USD y — desde 2026-08 — las Notas de Venta en USD, el
 * monto queda en dólares. Los reportes (Dashboard, Caja, Finanzas) trabajan en
 * soles, así que deben convertir el monto por el tipo de cambio antes de sumar.
 */

/** Convierte un monto a Soles usando la moneda y el tipo de cambio del comprobante. */
type NumeroLike = number | string | { toNumber(): number } | null | undefined;

function aNumero(v: NumeroLike): number {
  if (v == null) return 0;
  if (typeof v === 'object' && typeof (v as any).toNumber === 'function') {
    return (v as any).toNumber();
  }
  return Number(v) || 0;
}

export function montoEnPen(
  monto: NumeroLike,
  tipoMoneda?: string | null,
  tipoCambio?: NumeroLike,
): number {
  const base = aNumero(monto);
  if (String(tipoMoneda || 'PEN').toUpperCase() !== 'USD') return base;
  const tc = aNumero(tipoCambio);
  // Si por algún dato antiguo no hay TC válido, se deja el monto tal cual (no
  // se infla ni se pierde); mejor no convertir que convertir con un TC falso.
  return tc > 0 ? base * tc : base;
}

/**
 * Expresión SQL equivalente a `montoEnPen`, para sumar en consultas crudas.
 * Uso: `SUM(${montoEnPenSql('mtoImpVenta')})`. Asume columnas `tipoMoneda` y
 * `tipoCambio` en la tabla consultada.
 */
export function montoEnPenSql(col = 'mtoImpVenta'): string {
  return `(${col} * CASE WHEN "tipoMoneda" = 'USD' AND COALESCE("tipoCambio", 0) > 0 THEN "tipoCambio" ELSE 1 END)`;
}
