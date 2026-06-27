/**
 * Normaliza una fecha "solo día" a mediodía UTC para evitar el corrimiento de
 * un día al mostrarla en zonas horarias negativas (p. ej. America/Lima UTC-5).
 *
 * `new Date('2026-06-28')` => 2026-06-28T00:00:00.000Z, que en Lima se ve como
 * 27/06. Con mediodía UTC (12:00) la fecha calendario se mantiene en cualquier
 * zona de UTC-12 a UTC+12.
 */
export function parseFechaSoloDia(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0),
    );
  }
  const soloFecha = String(value).slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = soloFecha.split('-').map(Number);
  if (!y || !m || !d) return new Date(value); // fallback si no es ISO date
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
