/**
 * El día de entrega programado, para imprimirlo en el comprobante.
 *
 * `EnvioDespacho.fechaEstimada` es un DÍA, no un instante: se guarda como
 * medianoche UTC. Formatearlo con el reloj del servidor lo corre un día hacia
 * atrás en Perú (UTC-5) y el cliente leería que su pedido llega el día anterior
 * al que le prometieron. Por eso se lee del texto ISO y no de un Date local.
 *
 * Es la misma regla que usa el panel (`frontend/.../fechaDeEnvio.ts`); si se
 * separan, la pantalla y el papel dirían días distintos.
 */
export const diaDeEnvio = (valor?: Date | string | null): string => {
  if (!valor) return '';
  const iso = valor instanceof Date ? valor.toISOString() : String(valor);
  const [anio, mes, dia] = iso.slice(0, 10).split('-');
  if (!anio || !mes || !dia) return '';
  return `${dia}/${mes}/${anio}`;
};
