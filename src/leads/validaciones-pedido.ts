/**
 * C1 y C16 — validar los datos antes de agendar.
 *
 * Un pedido con el celular mal escrito es un pedido que no se puede entregar,
 * y se descubre cuando el repartidor ya salió. Validar en el chat cuesta una
 * repregunta; validar en la puerta cuesta el viaje.
 *
 * El horario es configuración por empresa: las franjas de Hierba Sana son
 * suyas y el siguiente cliente tendrá otras.
 */

export interface ConfigHorarioEntrega {
  /** Primera hora a la que se entrega, en minutos desde medianoche. */
  desdeMin: number;
  /** Última hora de entrega entre semana. */
  hastaMin: number;
  /** Última hora los domingos y feriados (null = igual que entre semana). */
  hastaDomingoMin: number | null;
  /** Franja mínima que se le pide al cliente. */
  franjaMinimaMin: number;
  /** Cuánto tiene que faltar como mínimo desde que se agenda. */
  anticipacionMinimaMin: number;
  /** Después de esta hora ya no se agenda para el mismo día. */
  limiteMismoDiaMin: number;
}

const hhmm = (h: number, m = 0): number => h * 60 + m;

/** Lo de Hierba Sana, de su base de conocimiento. Default, no constante. */
export const HORARIO_HIERBA_SANA: ConfigHorarioEntrega = {
  desdeMin: hhmm(9),
  hastaMin: hhmm(19),
  hastaDomingoMin: hhmm(13),
  franjaMinimaMin: 60,
  anticipacionMinimaMin: 180,
  limiteMismoDiaMin: hhmm(17),
};

export interface Problema {
  campo: string;
  /** Lo que la IA tiene que resolver con el cliente. */
  detalle: string;
}

/** DNI peruano: 8 dígitos. */
export function validarDni(valor: unknown): Problema | null {
  const limpio = String(valor ?? '').replace(/\D/g, '');
  if (!limpio) return { campo: 'dni', detalle: 'Falta el DNI.' };
  if (limpio.length !== 8) {
    return {
      campo: 'dni',
      detalle: `El DNI debe tener 8 dígitos y tiene ${limpio.length}. Pídeselo de nuevo.`,
    };
  }
  return null;
}

/** Celular peruano: 9 dígitos que empiezan en 9. */
export function validarCelular(valor: unknown): Problema | null {
  // Se tolera el prefijo del país: la gente escribe +51 987654321.
  const limpio = String(valor ?? '')
    .replace(/\D/g, '')
    .replace(/^51(?=\d{9}$)/, '');
  if (!limpio) return { campo: 'celular', detalle: 'Falta el celular.' };
  if (limpio.length !== 9) {
    return {
      campo: 'celular',
      detalle: `El celular debe tener 9 dígitos y tiene ${limpio.length}. Pídeselo de nuevo.`,
    };
  }
  if (!limpio.startsWith('9')) {
    return {
      campo: 'celular',
      detalle: 'Un celular peruano empieza en 9. Confirma el número.',
    };
  }
  return null;
}

/** Deja el celular como se guarda: 9 dígitos, sin prefijo ni separadores. */
export function normalizarCelular(valor: unknown): string {
  return String(valor ?? '')
    .replace(/\D/g, '')
    .replace(/^51(?=\d{9}$)/, '');
}

export interface Franja {
  /** Día de la entrega. */
  fecha: Date;
  inicioMin: number;
  finMin: number;
}

/**
 * ¿La franja que pidió el cliente se puede cumplir?
 *
 * Se valida contra `ahora` y no contra la hora del sistema para poder probarlo
 * sin depender de cuándo se corre el test.
 */
export function validarFranja(
  franja: Franja,
  ahora: Date,
  config: ConfigHorarioEntrega = HORARIO_HIERBA_SANA,
): Problema | null {
  const esDomingo = franja.fecha.getDay() === 0;
  const hasta =
    esDomingo && config.hastaDomingoMin != null
      ? config.hastaDomingoMin
      : config.hastaMin;

  if (franja.inicioMin < config.desdeMin || franja.finMin > hasta) {
    return {
      campo: 'horario',
      detalle: `Se entrega de ${enTexto(config.desdeMin)} a ${enTexto(hasta)}${esDomingo ? ' los domingos' : ''}. Propón una franja dentro de ese rango.`,
    };
  }
  if (franja.finMin - franja.inicioMin < config.franjaMinimaMin) {
    return {
      campo: 'horario',
      detalle: `La franja debe ser de al menos ${config.franjaMinimaMin} minutos.`,
    };
  }

  const inicio = new Date(franja.fecha);
  inicio.setHours(0, franja.inicioMin, 0, 0);

  // El corte del mismo día va ANTES que la anticipación. Si son las 6 p. m. y
  // pide para hoy, decirle "faltan 3 horas" le haría pensar que a las 9 p. m.
  // sí se puede, y a esa hora ya está cerrado. Lo que necesita oír es que hoy
  // ya no hay y que se le ofrece mañana.
  const esMismoDia = inicio.toDateString() === ahora.toDateString();
  const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
  if (esMismoDia && ahoraMin >= config.limiteMismoDiaMin) {
    return {
      campo: 'horario',
      detalle: `Después de las ${enTexto(config.limiteMismoDiaMin)} ya no se agenda para el mismo día. Ofrécele el día siguiente.`,
    };
  }

  const faltanMin = (inicio.getTime() - ahora.getTime()) / 60000;
  if (faltanMin < config.anticipacionMinimaMin) {
    return {
      campo: 'horario',
      detalle: `La entrega necesita al menos ${config.anticipacionMinimaMin / 60} horas desde que se agenda. Propón una franja más tarde.`,
    };
  }
  return null;
}

function enTexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`;
}
