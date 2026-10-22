/**
 * El delivery de un pedido del chat no se factura.
 *
 * El bot de IA de Ventas mete el envío en la nota de venta como una línea
 * libre ("ENVÍO DELIVERY", "ENVÍO AREQUIPA (AGENCIA)"): así el total de la nota
 * cuadra con la cotización, el adelanto y el saldo (Hierba Sana, 20-10: "ya
 * no sería 14 sino 24"). Pero su contadora fijó que el servicio de delivery
 * NO suma al total de la boleta ni de la guía: queda solo como observación
 * (17-10, confirmado el 22-10). Si sumara, entraría a la base imponible.
 *
 * Se aplica solo a notas que armó el bot (tienen un pedido de chat detrás):
 * una línea "ENVÍO" que alguien escribió a mano en el POS se factura como
 * siempre.
 */

/** La línea de envío que arma el bot: sin producto y con la descripción "ENVÍO …". */
export const esLineaDeDelivery = (l: { productoId?: unknown; descripcion?: unknown }): boolean =>
  (l?.productoId === null || l?.productoId === undefined || l?.productoId === '') &&
  /^\s*ENV[IÍ]O\b/i.test(String(l?.descripcion ?? ''));

const monto = (l: any): number => {
  const unitario = Number(l?.nuevoValorUnitario ?? l?.mtoPrecioUnitario ?? l?.precioUnitario ?? 0);
  const cantidad = Number(l?.cantidad ?? 1);
  return Number.isFinite(unitario * cantidad) ? unitario * cantidad : 0;
};

/**
 * Saca las líneas de delivery y devuelve cuánto sumaban, para dejarlo escrito
 * en las observaciones. Si quitar el delivery dejara el comprobante vacío, no
 * se quita nada: un pedido de solo envío no es un caso que tenga sentido
 * facturar distinto, y una boleta sin líneas no se puede emitir.
 */
export function separarDelivery<T extends { productoId?: unknown; descripcion?: unknown }>(
  lineas: T[],
): { lineas: T[]; delivery: number; descripciones: string[] } {
  const delivery = (lineas ?? []).filter(esLineaDeDelivery);
  const resto = (lineas ?? []).filter((l) => !esLineaDeDelivery(l));
  if (!delivery.length || !resto.length) return { lineas, delivery: 0, descripciones: [] };
  return {
    lineas: resto,
    delivery: Math.round(delivery.reduce((a, l) => a + monto(l), 0) * 100) / 100,
    descripciones: delivery.map((l) => String(l.descripcion).trim()),
  };
}

/** Lo que se agrega a las observaciones del comprobante. */
export function observacionDelivery(delivery: number, descripciones: string[]): string {
  const que = descripciones.length === 1 ? descripciones[0] : 'Servicio de delivery';
  return `${que}: S/ ${delivery.toFixed(2)} (servicio de delivery, se cobra aparte y no forma parte del total)`;
}

/** Junta la observación del delivery con la que ya traía el comprobante. */
export function conObservacionDelivery(
  observaciones: string | null | undefined,
  delivery: number,
  descripciones: string[],
): string {
  const nota = observacionDelivery(delivery, descripciones);
  const previa = String(observaciones ?? '').trim();
  if (previa.includes(nota)) return previa;
  return previa ? `${previa}\n${nota}` : nota;
}
