/**
 * Los avisos de "Tu suscripción vence en N días" de la campana.
 *
 * Hasta el 22-10 se creaba uno nuevo cada mañana durante la última semana y
 * ninguno se borraba al renovar: el empresario que ya había pagado seguía con
 * "¡Tu suscripción vence mañana!" sin leer en la campana (SANTOS CORREA,
 * renovado al 21/11, con diez avisos así; IMPORTEMOS JUNTOS con 39). Parecía
 * que el plan se le terminaba cuando no era así.
 *
 * Sin Prisma, para poder probarlo entero.
 */

export const TITULO_AVISO_RENOVACION = 'Renovación de Suscripción';

/** Días antes del vencimiento en que empieza a avisarse. */
export const DIAS_AVISO_RENOVACION = 7;

/**
 * Un aviso creado en `creadoEn` hablaba de un vencimiento dentro de los 7 días
 * siguientes. Si hoy el plan vence después de eso (con un día de margen por el
 * redondeo), alguien lo renovó y el aviso ya no es cierto.
 */
export function corteAvisosObsoletos(fechaExpiracion: Date): Date {
  return new Date(
    fechaExpiracion.getTime() - (DIAS_AVISO_RENOVACION + 1) * 86_400_000,
  );
}

export function esAvisoObsoleto(
  aviso: { titulo: string; creadoEn: Date },
  fechaExpiracion: Date | null | undefined,
): boolean {
  if (aviso.titulo !== TITULO_AVISO_RENOVACION || !fechaExpiracion) return false;
  return aviso.creadoEn < corteAvisosObsoletos(fechaExpiracion);
}

/** Inicio del día de hoy en Lima (UTC-5 todo el año). */
export function inicioDelDiaLima(ahora: Date = new Date()): Date {
  const lima = new Date(ahora.getTime() - 5 * 3_600_000);
  return new Date(
    Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate(), 5),
  );
}

/**
 * Días que faltan, contando días de calendario en Lima. La fecha se guarda
 * como medianoche UTC del día que vence ("2026-10-25T00:00Z" = vence el 25) y
 * se trabaja todo ese día (ver gracia-suscripcion.ts).
 */
export function diasParaVencerLima(
  fechaExpiracion: Date,
  ahora: Date = new Date(),
): number {
  const vence = Date.UTC(
    fechaExpiracion.getUTCFullYear(),
    fechaExpiracion.getUTCMonth(),
    fechaExpiracion.getUTCDate(),
  );
  const lima = new Date(ahora.getTime() - 5 * 3_600_000);
  const hoy = Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate());
  return Math.round((vence - hoy) / 86_400_000);
}

export function mensajeAvisoRenovacion(dias: number): {
  tipo: 'INFO' | 'WARNING' | 'CRITICAL';
  mensaje: string;
} {
  if (dias <= 0) {
    return { tipo: 'CRITICAL', mensaje: '¡Tu suscripción vence hoy! Renueva ahora para evitar interrupciones.' };
  }
  if (dias === 1) {
    return { tipo: 'CRITICAL', mensaje: '¡Tu suscripción vence mañana! Renueva ahora para evitar interrupciones.' };
  }
  if (dias <= 3) {
    return { tipo: 'WARNING', mensaje: `Tu suscripción vence en ${dias} días. Considera renovar pronto.` };
  }
  return { tipo: 'INFO', mensaje: `Tu suscripción vence en ${dias} días.` };
}
