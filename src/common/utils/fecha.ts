/**
 * Normaliza una fecha "solo día" a mediodía UTC para evitar el corrimiento de
 * un día al mostrarla en zonas horarias negativas (p. ej. America/Lima UTC-5).
 *
 * `new Date('2026-06-28')` => 2026-06-28T00:00:00.000Z, que en Lima se ve como
 * 27/06. Con mediodía UTC (12:00) la fecha calendario se mantiene en cualquier
 * zona de UTC-12 a UTC+12.
 */
/**
 * Fecha de emisión tal como la manda el cliente. El POS envía un ISO completo
 * con hora (se respeta); los importadores y la emisión retroactiva mandan solo
 * "YYYY-MM-DD", y `new Date('YYYY-MM-DD')` es medianoche UTC por spec — las
 * 19:00 del día ANTERIOR en Lima, aunque `TZ=America/Lima`. Un comprobante
 * importado del día 1 caía así en el mes anterior en los reportes.
 */
export function parseFechaEmision(
  value: string | Date | null | undefined,
): Date {
  if (value instanceof Date) return value;
  const s = String(value ?? '').trim();
  if (!s) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseFechaSoloDia(s);
  return new Date(s);
}

export function parseFechaSoloDia(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        12,
        0,
        0,
      ),
    );
  }
  const soloFecha = String(value).slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = soloFecha.split('-').map(Number);
  if (!y || !m || !d) return new Date(value); // fallback si no es ISO date
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

const DIA_MS = 24 * 60 * 60 * 1000;
// Perú está en UTC-5 todo el año: no hay horario de verano que considerar.
const OFFSET_LIMA_MS = 5 * 60 * 60 * 1000;

/** Número de día calendario en Lima (días desde 1970-01-01) de un instante. */
export function diaCalendarioLima(instante: Date): number {
  return Math.floor((instante.getTime() - OFFSET_LIMA_MS) / DIA_MS);
}

/**
 * Cuántos días calendario de Lima hay entre dos instantes: 0 si caen el mismo
 * día, 1 si `desde` fue ayer, aunque solo hayan pasado unas horas.
 *
 * Contar bloques de 24 h no sirve para hablar de "hoy" y "ayer": una venta del
 * sábado a las 5:57 p. m. vista el domingo a las 9:51 a. m. son 16 horas, cero
 * bloques, y el panel de empresas decía "Facturó hoy" de una cuenta que ese
 * día ya estaba bloqueada (EILEEN SHOP, 2026-10-19).
 */
export function diasCalendarioLima(
  desde: Date,
  hasta: Date = new Date(),
): number {
  return diaCalendarioLima(hasta) - diaCalendarioLima(desde);
}
