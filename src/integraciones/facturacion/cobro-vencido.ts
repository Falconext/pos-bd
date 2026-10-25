/**
 * Cuándo un cobro de la API está vencido.
 *
 * Regla decidida 25-10: si el integrador no paga, desde el día siguiente al
 * vencimiento no puede emitir hasta pagar. "Día" es de Lima, no UTC: con la
 * hora cruda, un cobro que vence el 17 se cortaría a las 7 p. m. del 16, que
 * es exactamente el bug que ya le quitó un día a los planes del ERP.
 */
const LIMA_MS = 5 * 60 * 60 * 1000; // Perú es UTC-5 todo el año

/** 23:59:59.999 de Lima del día en que vence. */
export const finDelDiaLima = (fecha: Date): Date => {
  const lima = new Date(fecha.getTime() - LIMA_MS);
  return new Date(
    Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(), 23, 59, 59, 999) + LIMA_MS,
  );
};

export const estaVencido = (fechaVencimiento: Date, ahora: Date = new Date()): boolean =>
  ahora.getTime() > finDelDiaLima(fechaVencimiento).getTime();

/** El mensaje que ve el integrador, en la API y en la consola. */
export const mensajeCobroVencido = (vencidos: { periodo: string; monto: number }[]): string => {
  const total = vencidos.reduce((s, c) => s + c.monto, 0);
  const meses = vencidos.map((c) => c.periodo).join(', ');
  return (
    `Tienes un pago vencido (${meses}: S/ ${total.toFixed(2)}). Mientras no se pague no se pueden emitir comprobantes; ` +
    'las pruebas, las consultas y las anulaciones siguen funcionando. Paga en https://developers.krezka.com/console/consumo y se reactiva al instante.'
  );
};
