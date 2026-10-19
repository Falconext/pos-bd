/**
 * Fechas de los pagos al EDITAR una nota ya cobrada.
 *
 * La edición reemplaza los pagos de la nota por el pago completo que manda la
 * pantalla (lo cobrado antes + lo cobrado ahora). Antes todos se recreaban con
 * la fecha de la edición: si la nota se cobró ayer (caja ya cerrada) y hoy se
 * cobra la diferencia, el cobro de ayer "se mudaba" a hoy y el cierre de ayer
 * quedaba descuadrado.
 *
 * Ahora cada línea nueva consume primero lo que ya existía en el MISMO medio
 * (conserva su fecha y su usuario); solo el excedente es plata nueva y va con
 * la fecha de la edición. Así la caja de hoy suma la diferencia (24.20) y la de
 * ayer se queda con lo que de verdad entró ese día (20.80).
 */

export interface PagoAnterior {
  monto: number;
  medioPago: string;
  fecha: Date;
  usuarioId?: number | null;
}

export interface LineaPagoEdicion {
  method: string;
  amount: number;
  [extra: string]: any;
}

export type LineaFechada<T extends LineaPagoEdicion> = T & {
  fecha: Date;
  /** null = usar el usuario que edita. */
  usuarioId: number | null;
  /** true si es plata que ya estaba registrada antes de la edición. */
  heredado: boolean;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
const medio = (m?: string | null) =>
  String(m ?? '')
    .trim()
    .toUpperCase() || 'EFECTIVO';

export function fecharPagosEdicion<T extends LineaPagoEdicion>(
  anteriores: PagoAnterior[],
  lineas: T[],
  fechaNueva: Date,
): LineaFechada<T>[] {
  const bolsas = new Map<string, { monto: number; fecha: Date; usuarioId: number | null }[]>();
  for (const p of [...anteriores].sort(
    (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
  )) {
    const monto = r2(p.monto);
    if (monto <= 0) continue;
    const k = medio(p.medioPago);
    if (!bolsas.has(k)) bolsas.set(k, []);
    bolsas.get(k)!.push({ monto, fecha: new Date(p.fecha), usuarioId: p.usuarioId ?? null });
  }

  const out: LineaFechada<T>[] = [];
  for (const linea of lineas) {
    let resta = r2(linea.amount);
    const bolsa = bolsas.get(medio(linea.method)) ?? [];
    for (const previo of bolsa) {
      if (resta <= 0) break;
      if (previo.monto <= 0) continue;
      const toma = r2(Math.min(resta, previo.monto));
      previo.monto = r2(previo.monto - toma);
      resta = r2(resta - toma);
      out.push({ ...linea, amount: toma, fecha: previo.fecha, usuarioId: previo.usuarioId, heredado: true });
    }
    if (resta > 0) {
      out.push({ ...linea, amount: resta, fecha: fechaNueva, usuarioId: null, heredado: false });
    }
  }
  return out;
}

/**
 * Líneas extra del ticket/PDF de una nota editada que ya estaba cobrada
 * (`paymentDetails.pagoAnterior` lo guarda el POS). Devuelve {} si no aplica,
 * para no tocar el ticket de una venta normal.
 */
export function cobroDeEdicion(
  paymentDetails: any,
  esCredito: boolean,
): { pagoAnterior?: string; recibido?: string; devolucion?: string } {
  let pd = paymentDetails;
  if (typeof pd === 'string') {
    try {
      pd = JSON.parse(pd);
    } catch {
      pd = null;
    }
  }
  const anterior = r2(Number(pd?.pagoAnterior || 0));
  if (esCredito || !(anterior > 0)) return {};
  const recibido = r2(Number(pd?.recibido || 0));
  const devolucion = r2(Number(pd?.devolucion || 0));
  return {
    pagoAnterior: anterior.toFixed(2),
    ...(recibido > 0 ? { recibido: recibido.toFixed(2) } : {}),
    ...(devolucion > 0 ? { devolucion: devolucion.toFixed(2) } : {}),
  };
}
