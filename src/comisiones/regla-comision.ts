/**
 * Elección de la regla de comisión que aplica a una venta.
 *
 * Cada regla tiene condiciones opcionales —producto, vendedor, días— y un NULL
 * significa "cualquiera". Gana la que cumple MÁS condiciones: una regla para
 * "este producto, los fines de semana" le gana a una de "los fines de semana",
 * que a su vez le gana a una sin condiciones.
 *
 * Si ninguna coincide se devuelve null y el cálculo sigue por la cascada de
 * siempre (producto → vendedor). Por eso una empresa sin reglas no cambia de
 * comportamiento: la tabla vacía no coincide con nada.
 */

export interface ReglaComision {
  id: number;
  /** NULL = cualquier producto. */
  productoId?: number | null;
  /** NULL = cualquier vendedor. */
  vendedorId?: number | null;
  /** "0,6" = domingo y sábado. NULL = todos los días. */
  diasSemana?: string | null;
  montoFijo?: unknown;
  porcentaje?: unknown;
  activa?: boolean;
}

export interface ContextoVenta {
  productoId: number;
  vendedorId: number;
  /** Momento de la venta; el día se resuelve en hora de Perú. */
  fecha: Date;
}

/**
 * Día de la semana en Perú (0 = domingo … 6 = sábado).
 *
 * Se resuelve en America/Lima y no con el reloj del servidor: una venta del
 * domingo a las 23:30 de Lima ya es lunes en UTC, y se pagaría a la tarifa
 * equivocada. El servidor corre en hora de Lima, pero depender de eso hace que
 * el cálculo dependa de una variable de entorno.
 */
export const diaEnPeru = (fecha: Date): number => {
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const etiqueta = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    weekday: 'short',
  }).format(fecha);
  return dias.indexOf(etiqueta);
};

const diasDeLaRegla = (diasSemana?: string | null): number[] | null => {
  if (diasSemana == null || String(diasSemana).trim() === '') return null;
  const dias = String(diasSemana)
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return dias.length ? dias : null;
};

/** ¿Esta regla aplica a esta venta? */
export const reglaAplica = (
  regla: ReglaComision,
  venta: ContextoVenta,
): boolean => {
  if (regla.activa === false) return false;
  if (regla.productoId != null && regla.productoId !== venta.productoId) {
    return false;
  }
  if (regla.vendedorId != null && regla.vendedorId !== venta.vendedorId) {
    return false;
  }
  const dias = diasDeLaRegla(regla.diasSemana);
  if (dias && !dias.includes(diaEnPeru(venta.fecha))) return false;
  return true;
};

/** Cuántas condiciones fija la regla: a más condiciones, más específica. */
export const especificidad = (regla: ReglaComision): number =>
  (regla.productoId != null ? 1 : 0) +
  (regla.vendedorId != null ? 1 : 0) +
  (diasDeLaRegla(regla.diasSemana) ? 1 : 0);

/**
 * La regla que gana, o null si ninguna aplica.
 *
 * Entre dos reglas igual de específicas gana la de id más alto: la última
 * cargada. Es arbitrario, pero es determinista y explicable —"vale la más
 * reciente"—, que es lo que hace falta cuando un vendedor reclama.
 */
export const elegirRegla = (
  reglas: ReglaComision[],
  venta: ContextoVenta,
): ReglaComision | null => {
  let ganadora: ReglaComision | null = null;
  let mejor = -1;
  for (const regla of reglas) {
    if (!reglaAplica(regla, venta)) continue;
    const puntos = especificidad(regla);
    if (puntos > mejor || (puntos === mejor && regla.id > (ganadora?.id ?? -1))) {
      ganadora = regla;
      mejor = puntos;
    }
  }
  return ganadora;
};

const NOMBRE_DIA = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

/**
 * Cómo se calculó la comisión, en palabras.
 *
 * Va guardado en cada comisión. Cuando un vendedor reclama que le pagaron de
 * menos, esta línea es la diferencia entre resolverlo en un minuto y ponerse a
 * leer código.
 */
export const describirRegla = (
  regla: ReglaComision,
  venta: ContextoVenta,
): string => {
  const partes: string[] = [];
  const dias = diasDeLaRegla(regla.diasSemana);
  if (dias) {
    const esFinDeSemana = dias.length === 2 && dias.includes(0) && dias.includes(6);
    partes.push(
      esFinDeSemana ? 'fin de semana' : dias.map((d) => NOMBRE_DIA[d]).join(' y '),
    );
  }
  if (regla.productoId != null) partes.push('este producto');
  if (regla.vendedorId != null) partes.push('este vendedor');
  const condiciones = partes.length ? ` (${partes.join(', ')})` : '';
  return `Regla de comisión${condiciones}`;
};
