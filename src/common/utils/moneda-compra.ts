/**
 * Conversión a soles de compras y pagos a proveedores.
 *
 * Regla del sistema (compras en dólares): los documentos se guardan en su moneda
 * (US$) con el TC de la fecha del documento; cualquier reporte en soles usa ESE
 * TC, así el número queda fijo y reproducible (costo histórico). Los pagos
 * traen su propio TC (el del día del pago) en `montoSoles`.
 */

export interface DocMoneda {
  moneda?: string | null;
  tipoCambio?: unknown;
}

export interface PagoMoneda {
  monto: unknown;
  montoSoles?: unknown;
  tipoCambio?: unknown;
  moneda?: string | null;
}

/** Factor documento → soles: 1 para PEN; el TC guardado para USD (1 si faltara). */
export const factorCompraASoles = (doc: DocMoneda | null | undefined): number => {
  if (!doc || String(doc.moneda ?? 'PEN').toUpperCase() !== 'USD') return 1;
  const tc = Number(doc.tipoCambio);
  return Number.isFinite(tc) && tc > 0 ? tc : 1;
};

/** Un monto de la compra (total, saldo, subtotal…) llevado a soles. */
export const montoCompraEnSoles = (
  monto: unknown,
  doc: DocMoneda | null | undefined,
): number => (Number(monto) || 0) * factorCompraASoles(doc);

/**
 * Lo que realmente salió en soles por un pago a proveedor. Usa `montoSoles`
 * (monto × TC del día del pago); si un pago viejo no lo tuviera, cae al TC de
 * la compra.
 */
export const pagoCompraEnSoles = (
  pago: PagoMoneda,
  compra?: DocMoneda | null,
): number => {
  if (pago.montoSoles != null && Number.isFinite(Number(pago.montoSoles))) {
    return Number(pago.montoSoles);
  }
  const tcPago = Number(pago.tipoCambio);
  const esUsd =
    String(pago.moneda ?? compra?.moneda ?? 'PEN').toUpperCase() === 'USD';
  if (!esUsd) return Number(pago.monto) || 0;
  const tc =
    Number.isFinite(tcPago) && tcPago > 0 ? tcPago : factorCompraASoles(compra);
  return (Number(pago.monto) || 0) * tc;
};

/**
 * Monto de un pago expresado en la moneda de una cuenta bancaria: si la cuenta
 * es de la misma moneda que el documento va tal cual; una cuenta en soles que
 * pagó una factura en dólares registra el equivalente en soles, y una cuenta en
 * dólares que pagó una factura en soles, el equivalente en dólares al TC del pago.
 */
export const pagoEnMonedaCuenta = (
  pago: PagoMoneda,
  compra: DocMoneda | null | undefined,
  monedaCuenta: string | null | undefined,
): number => {
  const monedaPago = String(pago.moneda ?? compra?.moneda ?? 'PEN').toUpperCase();
  const cuenta = String(monedaCuenta ?? 'PEN').toUpperCase();
  if (monedaPago === cuenta) return Number(pago.monto) || 0;
  if (cuenta === 'PEN') return pagoCompraEnSoles(pago, compra);
  // Cuenta en USD pagando un documento en soles.
  const tc = Number(pago.tipoCambio) || factorCompraASoles(compra) || 1;
  return tc > 1 ? (Number(pago.monto) || 0) / tc : Number(pago.monto) || 0;
};
