/**
 * Fecha y hora con que sale una guía que SUNAT todavía no recibió.
 *
 * La guía se podía crear un día y enviar otro. Al editarla, el formulario
 * cambiaba la fecha pero conservaba la hora original, y el XML decía
 * "emitida hoy a las 16:03" cuando se enviaba a las 10:25: SUNAT la rechazaba
 * por "Fecha/hora mayor a la recepción". (IRBA, guía 102, 26-10.)
 *
 * Una guía que SUNAT no recibió es un borrador: se emite cuando se envía. Por
 * eso fecha y hora se fijan al momento del envío, en hora de Lima. El inicio
 * del traslado no puede quedar antes de la emisión, así que si era anterior
 * pasa a hoy.
 *
 * Vive aparte del servicio para poder probarse sin Prisma.
 */

export interface EmisionAlEnviar {
  fechaEmision: Date;
  horaEmision: string;
  fechaInicioTraslado?: Date;
}

/** Fecha (YYYY-MM-DD) y hora (HH:mm:ss) de Lima para un instante dado. */
export const ahoraEnLima = (instante: Date): { fecha: string; hora: string } => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(instante)
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
};

/**
 * Los campos a guardar antes de enviar. Las fechas se guardan como medianoche
 * UTC del día de Lima, igual que las crea el formulario: el XML lee el día UTC.
 */
export function emisionAlEnviar(
  guia: { fechaInicioTraslado?: Date | string | null },
  instante: Date,
): EmisionAlEnviar {
  const { fecha, hora } = ahoraEnLima(instante);
  const hoy = new Date(`${fecha}T00:00:00.000Z`);
  const r: EmisionAlEnviar = { fechaEmision: hoy, horaEmision: hora };
  if (guia.fechaInicioTraslado) {
    const inicio = new Date(guia.fechaInicioTraslado);
    if (inicio.getTime() < hoy.getTime()) r.fechaInicioTraslado = hoy;
  }
  return r;
}
