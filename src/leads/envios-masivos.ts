/**
 * Envíos masivos — reglas puras.
 *
 * Cada destinatario se decide justo antes de mandarle, no al confirmar: un
 * envío programado para el sábado se confirma el jueves, y en esos dos días
 * el cliente puede pedir la baja, recibir otro aviso comercial o quedar en
 * medio de una conversación con un asesor.
 */
import { ventanaAbierta } from './leads-disparadores';

export type EstadoEnvio = 'PROGRAMADO' | 'ENVIANDO' | 'TERMINADO' | 'CANCELADO';

/** Ritmo permitido: lento cuida la calidad del número; muy lento no termina nunca. */
export const RITMO_MIN = 5;
export const RITMO_MAX = 80;
export const RITMO_DEFECTO = 30;

export function ritmoValido(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return RITMO_DEFECTO;
  return Math.min(RITMO_MAX, Math.max(RITMO_MIN, v));
}

/** Hasta cuándo se puede programar. Más lejos, el segmento ya no es el mismo. */
export const DIAS_MAX_PROGRAMACION = 30;

/**
 * La fecha pedida, validada. Null = ahora. Una fecha pasada (más de unos
 * minutos) es un error de quien programa: mandarla "ya" sin avisar sorprende.
 */
export function fechaProgramada(
  crudo: unknown,
  ahora: Date,
): { fecha: Date } | { error: string } {
  if (crudo === undefined || crudo === null || crudo === '')
    return { fecha: ahora };
  const f = new Date(String(crudo));
  if (Number.isNaN(f.getTime()))
    return { error: 'La fecha programada no es válida.' };
  if (f.getTime() < ahora.getTime() - 5 * 60_000) {
    return { error: 'La fecha programada ya pasó.' };
  }
  if (f.getTime() > ahora.getTime() + DIAS_MAX_PROGRAMACION * 24 * 3600_000) {
    return {
      error: `Se puede programar hasta ${DIAS_MAX_PROGRAMACION} días adelante.`,
    };
  }
  return { fecha: f };
}

export interface SituacionDestinatario {
  canal: string;
  interno: boolean;
  deBaja: boolean;
  marketingRecientes: number;
  tope: number;
  /** Hay una persona atendiendo ese chat ahora. */
  botPausado: boolean;
  ultimoMensajeDelCliente: Date | null;
  ahora: Date;
}

export type Decision =
  | { enviar: true; via: 'plantilla' | 'texto' }
  | { enviar: false; motivo: string };

/** ¿Se le manda, y cómo? */
export function decidirDestinatario(s: SituacionDestinatario): Decision {
  if (s.interno)
    return { enviar: false, motivo: 'Es un número del propio negocio.' };
  if (s.deBaja)
    return { enviar: false, motivo: 'El cliente pidió no recibir más avisos.' };
  if (s.marketingRecientes >= s.tope) {
    return {
      enviar: false,
      motivo: `Ya recibió ${s.marketingRecientes} mensajes comerciales en el periodo del tope.`,
    };
  }
  // Una promoción en medio de una conversación con un asesor la contradice
  // delante del cliente.
  if (s.botPausado)
    return { enviar: false, motivo: 'Había alguien atendiendo este chat.' };

  if (s.canal === 'WHATSAPP') return { enviar: true, via: 'plantilla' };
  // Instagram y Messenger no tienen plantillas: solo dentro de las 24 h.
  if (ventanaAbierta(s.ultimoMensajeDelCliente, s.ahora))
    return { enviar: true, via: 'texto' };
  return {
    enviar: false,
    motivo: `${s.canal === 'MESSENGER' ? 'Messenger' : 'Instagram'}: pasaron más de 24 h desde su último mensaje y no hay plantillas.`,
  };
}

/**
 * Cuántos contactos distintos puede recibir por WhatsApp este envío según el
 * nivel de Meta del número. Pasarse no da error al confirmar: Meta corta a
 * mitad del envío y la calidad del número baja.
 */
export function excedeNivel(
  destinatariosWhatsapp: number,
  nivel: number | null,
): boolean {
  return nivel !== null && destinatariosWhatsapp > nivel;
}

/**
 * ¿El error de Meta es de la plantilla y no del destinatario? Esos fallan
 * igual con todos los que siguen (132000-132016: plantilla inexistente,
 * pausada, desactivada, parámetros que no calzan).
 */
export function esFallaDePlantilla(motivo: string | null | undefined): boolean {
  return /\(#1320\d\d\)|template (name )?does not exist|template.*(paused|disabled)/i.test(
    motivo ?? '',
  );
}

// ─── Resultados ─────────────────────────────────────────────────────────────

/** Una respuesta cuenta si llega dentro de este plazo desde que se le mandó. */
export const HORAS_RESPUESTA = 72;
/** Una compra se atribuye al envío si ocurre dentro de este plazo. */
export const DIAS_COMPRA = 7;

/** Medianoche de Lima del día de `fecha` (Lima es UTC-5 todo el año). */
export function inicioDelDiaLima(fecha: Date): Date {
  const enLima = new Date(fecha.getTime() - 5 * 3600_000);
  return new Date(
    Date.UTC(
      enLima.getUTCFullYear(),
      enLima.getUTCMonth(),
      enLima.getUTCDate(),
      5,
      0,
      0,
      0,
    ),
  );
}

/**
 * ¿Esta compra se cuenta como venta del envío? Desde el inicio del día en que
 * se mandó: las notas de venta guardan solo la fecha (quedan a las 00:00 o a
 * las 12:00), y con la hora exacta una compra de esa misma tarde quedaba
 * fuera. El costo es contar alguna compra de esa mañana anterior al envío.
 */
export function compraDelEnvio(compra: Date, enviadoEn: Date): boolean {
  const desde = inicioDelDiaLima(enviadoEn).getTime();
  const hasta = enviadoEn.getTime() + DIAS_COMPRA * 24 * 3600_000;
  return compra.getTime() >= desde && compra.getTime() <= hasta;
}

export interface EstadoDeMeta {
  id: string;
  status: string;
  timestamp?: string | number;
  errors?: {
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }[];
}

/**
 * Lo que hay que actualizar en el destinatario por un estado de WhatsApp.
 * "read" implica entregado aunque el "delivered" no haya llegado (Meta no
 * garantiza el orden ni que lleguen todos).
 */
export function cambiosPorEstado(
  e: EstadoDeMeta,
): { entregadoEn?: Date; leidoEn?: Date; fallo?: string } | null {
  const ts = Number(e.timestamp);
  const cuando =
    Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();
  switch (e.status) {
    case 'delivered':
      return { entregadoEn: cuando };
    case 'read':
      return { entregadoEn: cuando, leidoEn: cuando };
    case 'failed': {
      const err = e.errors?.[0];
      const detalle =
        err?.error_data?.details ||
        err?.message ||
        err?.title ||
        'Meta no pudo entregarlo';
      return {
        fallo: `${err?.code ? `(#${err.code}) ` : ''}${detalle}`.slice(0, 300),
      };
    }
    default:
      return null;
  }
}
