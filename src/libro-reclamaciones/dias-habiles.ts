/**
 * Días hábiles en Perú (hora de Lima) para el plazo del Libro de Reclamaciones.
 *
 * Funciones puras: todo se calcula sobre el "número de día" de Lima (días desde
 * 1970-01-01 en UTC-5). Perú no tiene horario de verano, así que el desfase es
 * fijo y no hace falta ninguna librería de zonas horarias.
 */

const DIA_MS = 24 * 60 * 60 * 1000;
const OFFSET_LIMA_MS = 5 * 60 * 60 * 1000;

/** Plazo legal de respuesta (D.S. 101-2022-PCM): 15 días hábiles. */
export const PLAZO_RESPUESTA_DIAS_HABILES = 15;

/** Un reclamo "está por vencer" si le quedan esta cantidad de días hábiles o menos. */
export const DIAS_HABILES_POR_VENCER = 3;

/** Feriados nacionales de fecha fija (MM-DD). */
const FERIADOS_FIJOS: readonly string[] = [
  '01-01', // Año Nuevo
  '05-01', // Día del Trabajo
  '06-07', // Batalla de Arica y Día de la Bandera
  '06-29', // San Pedro y San Pablo
  '07-23', // Día de la Fuerza Aérea
  '07-28', // Fiestas Patrias
  '07-29', // Fiestas Patrias
  '08-06', // Batalla de Junín
  '08-30', // Santa Rosa de Lima
  '10-08', // Combate de Angamos
  '11-01', // Todos los Santos
  '12-08', // Inmaculada Concepción
  '12-09', // Batalla de Ayacucho
  '12-25', // Navidad
];

/** Día de Lima (días desde 1970-01-01) de un instante. */
export function diaLima(instante: Date): number {
  return Math.floor((instante.getTime() - OFFSET_LIMA_MS) / DIA_MS);
}

/** Día de Lima de una fecha calendario. */
export function diaDeFecha(anio: number, mes: number, dia: number): number {
  return Math.floor(Date.UTC(anio, mes - 1, dia) / DIA_MS);
}

/** Año, mes (1-12) y día del mes de un día de Lima. */
export function fechaDeDia(dia: number): {
  anio: number;
  mes: number;
  dia: number;
} {
  const d = new Date(dia * DIA_MS);
  return {
    anio: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
  };
}

/** Año calendario en Lima de un instante (el 31-12 a las 23:00 de Lima sigue siendo ese año). */
export function anioLima(instante: Date): number {
  return fechaDeDia(diaLima(instante)).anio;
}

/** Último milisegundo (23:59:59.999 de Lima) de un día de Lima. */
export function finDelDiaLima(dia: number): Date {
  return new Date((dia + 1) * DIA_MS + OFFSET_LIMA_MS - 1);
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
export function domingoDePascua(anio: number): { mes: number; dia: number } {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

const cacheFeriados = new Map<number, ReadonlySet<number>>();

/** Feriados nacionales de un año, como días de Lima (incluye Jueves y Viernes Santo). */
export function feriadosPeru(anio: number): ReadonlySet<number> {
  const enCache = cacheFeriados.get(anio);
  if (enCache) return enCache;
  const dias = new Set<number>();
  for (const mmdd of FERIADOS_FIJOS) {
    const [mes, dia] = mmdd.split('-').map(Number);
    dias.add(diaDeFecha(anio, mes, dia));
  }
  const pascua = domingoDePascua(anio);
  const domingo = diaDeFecha(anio, pascua.mes, pascua.dia);
  dias.add(domingo - 3); // Jueves Santo
  dias.add(domingo - 2); // Viernes Santo
  cacheFeriados.set(anio, dias);
  return dias;
}

export function esFeriadoPeru(dia: number): boolean {
  return feriadosPeru(fechaDeDia(dia).anio).has(dia);
}

/** Lunes a viernes que no es feriado nacional. */
export function esDiaHabil(dia: number): boolean {
  // 1970-01-01 fue jueves: (dia + 4) % 7 da 0 = domingo … 6 = sábado.
  const diaSemana = (((dia + 4) % 7) + 7) % 7;
  if (diaSemana === 0 || diaSemana === 6) return false;
  return !esFeriadoPeru(dia);
}

/**
 * Fin del n-ésimo día hábil POSTERIOR al día del instante dado. El día del
 * registro no cuenta (aunque sea hábil): un reclamo del lunes con plazo de 1
 * día hábil vence el martes a las 23:59:59 de Lima.
 */
export function sumarDiasHabiles(desde: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError('n debe ser un entero mayor o igual a 0');
  }
  let dia = diaLima(desde);
  let contados = 0;
  while (contados < n) {
    dia += 1;
    if (esDiaHabil(dia)) contados += 1;
  }
  return finDelDiaLima(dia);
}

/** Fecha límite legal de respuesta para una hoja registrada en `fecha`. */
export function calcularFechaLimite(fecha: Date): Date {
  return sumarDiasHabiles(fecha, PLAZO_RESPUESTA_DIAS_HABILES);
}

function contarHabilesEntre(
  desdeExclusivo: number,
  hastaInclusivo: number,
): number {
  let total = 0;
  for (let d = desdeExclusivo + 1; d <= hastaInclusivo; d += 1) {
    if (esDiaHabil(d)) total += 1;
  }
  return total;
}

/**
 * Días hábiles que quedan hasta la fecha límite, contados desde hoy (Lima).
 *   - 0  → vence hoy.
 *   - >0 → quedan esos días hábiles.
 *   - <0 → ya venció: días hábiles transcurridos desde el vencimiento (mínimo -1,
 *          para que un sábado después de un viernes límite no se lea como "0").
 */
export function diasHabilesRestantes(
  fechaLimite: Date,
  ahora: Date = new Date(),
): number {
  const hoy = diaLima(ahora);
  const limite = diaLima(fechaLimite);
  if (ahora.getTime() <= fechaLimite.getTime()) {
    return contarHabilesEntre(hoy, limite);
  }
  return -Math.max(1, contarHabilesEntre(limite, hoy));
}

/**
 * Hasta qué instante una fecha límite cuenta como "por vencer" (≤ 3 días
 * hábiles). Como toda fecha límite cae al final de un día hábil, comparar con
 * este umbral equivale a `diasHabilesRestantes(...) <= 3`, y se puede filtrar
 * directo en la base.
 */
export function umbralPorVencer(ahora: Date = new Date()): Date {
  return sumarDiasHabiles(ahora, DIAS_HABILES_POR_VENCER);
}
