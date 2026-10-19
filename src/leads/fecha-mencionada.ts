/**
 * La fecha en que el cliente dijo que retoma, sacada de su mensaje.
 *
 * Respaldo de la herramienta `agendar_recordatorio`: en la prueba del 19-10
 * el cliente dijo "cobro a fin de mes y ahí te escribo", el modelo contestó
 * "a fin de mes te estaré escribiendo" y no agendó nada. Una promesa así sin
 * recordatorio detrás es peor que no prometer.
 *
 * Solo reconoce expresiones claras; ante la duda devuelve null (no se agenda).
 * Devuelve la fecha como AAAA-MM-DD en el calendario de Lima.
 */

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const NUMEROS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, quince: 15,
};

function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Hoy en Lima como { y, m (1-12), d, dow (0=domingo) }. */
function hoyEnLima(ahora: Date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' })
    .format(ahora)
    .split('-')
    .map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, dow };
}

function iso(y: number, m: number, d: number): string {
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.toISOString().slice(0, 10);
}

function sumarDias(base: { y: number; m: number; d: number }, n: number): string {
  return iso(base.y, base.m, base.d + n);
}

export function fechaMencionada(texto: string, ahora = new Date()): string | null {
  const t = normalizar(texto);
  const hoy = hoyEnLima(ahora);

  // "pasado mañana" antes que "mañana".
  if (/\bpasado manana\b/.test(t)) return sumarDias(hoy, 2);

  // Fin de mes / quincena.
  if (/\b(a |para |el )?fin(al)? de(l)? mes\b|\bfinales de mes\b|\bfin de mes\b/.test(t)) {
    const ultimo = new Date(Date.UTC(hoy.y, hoy.m, 0)).getUTCDate();
    // Si ya es fin de mes (últimos 2 días), el del mes que viene.
    if (hoy.d >= ultimo - 1) return iso(hoy.y, hoy.m + 1, new Date(Date.UTC(hoy.y, hoy.m + 1, 0)).getUTCDate());
    return iso(hoy.y, hoy.m, ultimo);
  }
  if (/\bquincena\b/.test(t)) {
    return hoy.d < 15 ? iso(hoy.y, hoy.m, 15) : iso(hoy.y, hoy.m + 1, 15);
  }

  // "en una semana", "en 3 días", "en dos semanas", "dentro de 10 días".
  const plazo = /\b(?:en|dentro de)\s+(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince)\s+(dia|dias|semana|semanas|mes|meses)\b/.exec(t);
  if (plazo) {
    const n = /^\d+$/.test(plazo[1]) ? Number(plazo[1]) : NUMEROS[plazo[1]];
    const unidad = plazo[2];
    const dias = unidad.startsWith('dia') ? n : unidad.startsWith('semana') ? n * 7 : n * 30;
    if (dias >= 1 && dias <= 120) return sumarDias(hoy, dias);
  }

  // "la próxima semana" / "la otra semana" / "la semana que viene" → próximo lunes.
  if (/\b(la )?(proxima|otra) semana\b|\bla semana que viene\b/.test(t)) {
    const hastaLunes = ((8 - hoy.dow) % 7) || 7;
    return sumarDias(hoy, hastaLunes);
  }

  // "el lunes", "este viernes", "el próximo martes".
  const dia = /\b(?:el|este|para el|el proximo|el otro)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(t);
  if (dia) {
    const objetivo = DIAS_SEMANA.indexOf(dia[1]);
    const n = ((objetivo - hoy.dow + 7) % 7) || 7;
    return sumarDias(hoy, n);
  }

  // "el 30", "el 15 de noviembre" (día del mes; si ya pasó, el mes que viene).
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const conMes = /\bel (\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.exec(t);
  if (conMes) {
    const d = Number(conMes[1]);
    const m = meses.indexOf(conMes[2] === 'septiembre' ? 'setiembre' : conMes[2]) + 1;
    if (d >= 1 && d <= 31) {
      const y = m < hoy.m || (m === hoy.m && d <= hoy.d) ? hoy.y + 1 : hoy.y;
      return iso(y, m, d);
    }
  }
  const soloDia = /\b(?:el|cuando cobre el|cobro el|hasta el)\s+(\d{1,2})\b(?!\s*(?:soles|unidades|frascos|%|am|pm|a\.m|p\.m|horas|hrs))/.exec(t);
  if (soloDia) {
    const d = Number(soloDia[1]);
    if (d >= 1 && d <= 31) {
      return d > hoy.d ? iso(hoy.y, hoy.m, d) : iso(hoy.y, hoy.m + 1, d);
    }
  }

  // "mañana" solo cuando habla de escribir/comprar/pagar, no "mañana de 3 a 5".
  if (/\bmanana\b/.test(t) && /\b(te escribo|te aviso|te confirmo|compro|pago|lo pido|te hablo|te llamo)\b/.test(t)) {
    return sumarDias(hoy, 1);
  }
  return null;
}
