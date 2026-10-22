/**
 * Cuándo un turno de caja sigue abierto.
 *
 * Hasta el 21-10 la caja era por día calendario: a las 12 de la noche el turno
 * dejaba de contar como abierto y había que abrir otro. Pedido de LA DESPENSA
 * HM, que abre a las 17:00 y vende pasada la medianoche: el turno sigue abierto
 * hasta que alguien lo cierre.
 *
 * El tope de horas existe por los turnos olvidados: uno abierto hace semanas no
 * puede volver a ser "la caja abierta" y juntar en su arqueo las ventas de días
 * que no fueron suyos. Pasado el tope, el turno queda como pendiente de cuadrar
 * (el aviso que ya existía), con su ventana cortada a su propio día.
 *
 * Sin Prisma, para poder probarlo entero.
 */

export const HORAS_TURNO_ABIERTO = 48;

/**
 * Rango de fechas donde buscar la última APERTURA/CIERRE para saber si hay un
 * turno abierto. Sin `ref` no se pone techo: la fecha de un movimiento la pone
 * la base y puede ir unos milisegundos adelante del reloj del servidor.
 */
export function ventanaTurnoAbierto(ref?: Date): { gte: Date; lte?: Date } {
  const hasta = ref ?? new Date();
  const gte = new Date(hasta.getTime() - HORAS_TURNO_ABIERTO * 3_600_000);
  return ref ? { gte, lte: ref } : { gte };
}

export interface MovimientoTurno {
  id: number;
  fecha: Date;
  tipoMovimiento: string;
  sedeId: number | null;
  usuarioId: number;
  /** En un CIERRE, la APERTURA que cierra (desde el 21-10; antes, null). */
  movimientoVinculadoId: number | null;
}

const diaLima = (fecha: Date) =>
  fecha.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

/**
 * Aperturas que nunca se cerraron y que ya no son el turno en curso de nadie.
 *
 * `movs` son APERTURA y CIERRE en orden de fecha. Cada CIERRE se empareja con
 * su apertura: por el vínculo si lo tiene; si es anterior al vínculo, con la
 * última apertura abierta del mismo usuario en la sede, y si no hay, con una
 * del mismo día (un administrador cuadrando el turno de otro).
 *
 * Una apertura sin cierre es el turno en curso —no un pendiente— si está dentro
 * del tope de horas y su usuario no abrió otra después en esa sede.
 */
export function turnosSinCuadrar<T extends MovimientoTurno>(
  movs: T[],
  ahora: Date = new Date(),
): T[] {
  const abiertas: T[] = [];
  const mismaSede = (a: T, b: T) => (a.sedeId ?? 0) === (b.sedeId ?? 0);

  for (const m of movs) {
    if (m.tipoMovimiento === 'APERTURA') {
      abiertas.push(m);
      continue;
    }
    if (m.tipoMovimiento !== 'CIERRE') continue;

    let i = -1;
    if (m.movimientoVinculadoId != null) {
      i = abiertas.findIndex((a) => a.id === m.movimientoVinculadoId);
    } else {
      for (let j = abiertas.length - 1; j >= 0 && i < 0; j--) {
        if (mismaSede(abiertas[j], m) && abiertas[j].usuarioId === m.usuarioId) i = j;
      }
      for (let j = abiertas.length - 1; j >= 0 && i < 0; j--) {
        if (mismaSede(abiertas[j], m) && diaLima(abiertas[j].fecha) === diaLima(m.fecha)) i = j;
      }
    }
    if (i >= 0) abiertas.splice(i, 1);
  }

  const desde = ventanaTurnoAbierto(ahora).gte;
  return abiertas.filter((a) => {
    const reciente = a.fecha >= desde;
    const reabrio = movs.some(
      (o) =>
        o.tipoMovimiento === 'APERTURA' &&
        o.fecha > a.fecha &&
        o.usuarioId === a.usuarioId &&
        mismaSede(o, a),
    );
    return !reciente || reabrio;
  });
}
