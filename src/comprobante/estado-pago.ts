/**
 * Estado y saldo de un comprobante según su condición de pago.
 *
 * Vive aparte del servicio para poder probarse: dentro del método de creación
 * —que tiene cientos de líneas y depende de Prisma— la regla solo se podía
 * verificar reimplementándola, y una prueba que reimplementa no prueba nada.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface EstadoPagoInicial {
  estado: 'COMPLETADO' | 'PENDIENTE_PAGO';
  saldo: number;
}

/**
 * Cuánto queda por cobrar y en qué estado nace el comprobante.
 *
 * `yaCobradoEnOrigen` es la plata que entró cuando se emitió el informal del
 * que proviene. Faltaba restarla: al convertir una nota de venta a crédito YA
 * cobrada, el saldo salía por el total, el sistema pedía un cronograma por
 * plata que el cliente ya había pagado y la emisión moría con "todas las cuotas
 * deben tener monto mayor a cero". No había forma de emitir el documento.
 * (Reportado por OWENSOFT al convertir NV01-297, S/280 ya cobrados.)
 *
 * Un crédito que queda en cero es una venta pagada: no hay nada que financiar
 * ni que aparecer en cuentas por cobrar.
 */
export const estadoYSaldoInicial = (params: {
  esCredito: boolean;
  total: number;
  detraccion?: number;
  yaCobradoEnOrigen?: number;
}): EstadoPagoInicial => {
  const { esCredito, total, detraccion = 0, yaCobradoEnOrigen = 0 } = params;
  if (!esCredito) return { estado: 'COMPLETADO', saldo: 0 };
  const saldo = Math.max(
    0,
    round2(Number(total) - Number(detraccion) - Number(yaCobradoEnOrigen)),
  );
  return { estado: saldo > 0 ? 'PENDIENTE_PAGO' : 'COMPLETADO', saldo };
};
