/**
 * Días de gracia entre que vence la suscripción y que se corta el acceso.
 *
 * Hasta ahora el vencimiento era un portazo: `fechaExpiracion < hoy` y la
 * empresa no entraba ni al login ni a ninguna petición. Con el cobro mensual
 * eso es peligroso — un pago que entra el martes por la tarde, una
 * transferencia que tarda, o más adelante una tarjeta que rebota y se reintenta,
 * dejarían sin sistema a un cliente que sí está pagando. La gracia le da unos
 * días para regularizar mientras el cobro sigue su curso.
 *
 * La ventana se calcula acá y no en el cron a propósito: si dependiera de que
 * el cron corrió, el acceso de un cliente cambiaría según la hora del día en
 * que alguien reinició el servidor. Así es la misma cuenta en todos lados.
 */

/** Días configurables; 3 por defecto, igual que la renovación de resellers. */
export function diasGraciaSuscripcion(): number {
  const raw = Number(process.env.SUSCRIPCION_GRACIA_DIAS ?? 3);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 3;
}

/**
 * Hasta cuándo vale el plan de verdad: el final de su día de vencimiento, en
 * hora de Lima.
 *
 * Acá vivía un error que le costaba un día entero a cada cliente. La fecha se
 * guarda como medianoche UTC del día que vence ("2026-10-15T00:00:00Z" = vence
 * el 15), que es como la lee el panel de empresas para decir "Vence hoy". Pero
 * el control de acceso comparaba el instante exacto, y esa medianoche UTC son
 * las 7 p.m. del 14 en Lima: EILEEN SHOP aparecía como "Vence hoy" en el panel
 * y a la vez recibía "Tu plan venció" al intentar entrar, desde la noche
 * anterior.
 *
 * Si dice que vence el 15, se trabaja todo el 15. El corte son las 23:59:59.999
 * de Lima de ese día — las 04:59:59.999 UTC del día siguiente, porque Perú está
 * en UTC-5 todo el año y no mueve el reloj.
 */
export function finDelDiaDeVencimiento(fechaExpiracion: Date): Date {
  const y = fechaExpiracion.getUTCFullYear();
  const m = fechaExpiracion.getUTCMonth();
  const d = fechaExpiracion.getUTCDate();
  // Medianoche de Lima del día siguiente, menos un milisegundo.
  return new Date(Date.UTC(y, m, d + 1, 5, 0, 0, 0) - 1);
}

/** Último instante en que la empresa todavía puede entrar sin haber pagado. */
export function finDeGracia(
  fechaExpiracion: Date,
  dias = diasGraciaSuscripcion(),
): Date {
  const fin = finDelDiaDeVencimiento(fechaExpiracion);
  fin.setDate(fin.getDate() + dias);
  return fin;
}

export interface EstadoGracia {
  /** Ya pasó la fecha de vencimiento. */
  vencida: boolean;
  /** Venció pero todavía está dentro de la ventana: entra, con aviso. */
  enGracia: boolean;
  /** Se acabó la gracia: no entra. */
  bloqueada: boolean;
  /** Días que le quedan de gracia (0 si ya se acabó o si no venció). */
  diasRestantes: number;
}

export function evaluarGracia(
  fechaExpiracion: Date | null | undefined,
  ahora: Date = new Date(),
): EstadoGracia {
  if (!fechaExpiracion) {
    return {
      vencida: false,
      enGracia: false,
      bloqueada: false,
      diasRestantes: 0,
    };
  }
  // El día de vencimiento todavía es suyo: solo está vencida cuando ese día
  // terminó en Lima.
  const vencida = finDelDiaDeVencimiento(fechaExpiracion) < ahora;
  if (!vencida) {
    return {
      vencida: false,
      enGracia: false,
      bloqueada: false,
      diasRestantes: 0,
    };
  }
  const fin = finDeGracia(fechaExpiracion);
  const bloqueada = fin < ahora;
  const diasRestantes = bloqueada
    ? 0
    : Math.max(
        0,
        Math.ceil((fin.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24)),
      );
  return { vencida: true, enGracia: !bloqueada, bloqueada, diasRestantes };
}

/** El mensaje que ve el empresario cuando ya no puede entrar. */
export const MENSAJE_PLAN_VENCIDO =
  'Tu plan venció y pasó el periodo de gracia. Regulariza el pago para volver a entrar.';
