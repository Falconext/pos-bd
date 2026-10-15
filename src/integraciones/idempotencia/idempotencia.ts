import { createHash } from 'node:crypto';

/**
 * Idempotencia para la API pública: que un reintento no emita dos veces.
 *
 * Es el riesgo número uno de abrir la facturación por API. Si el integrador
 * pierde la respuesta —timeout, 502 de un proxy, su propio proceso que muere—
 * va a reintentar. Sin esto, el reintento emite una SEGUNDA factura: las dos
 * válidas ante SUNAT, las dos con su correlativo, y deshacer una exige una
 * comunicación de baja. El cliente paga dos veces y el emisor queda con un
 * documento de más en su registro de ventas.
 *
 * Hoy el motor se defiende con `assertNoDobleSubmitReciente`, un heurístico:
 * rechaza un comprobante idéntico (mismo cliente, monto y tipo) emitido en los
 * últimos segundos. Para el panel sirve, porque ahí el duplicado siempre es un
 * doble clic. Para una API es DAÑINO: dos ventas reales iguales seguidas —dos
 * cafés al mismo cliente anónimo por el mismo monto— son legítimas y se
 * rechazarían. Con una clave de idempotencia explícita el heurístico sobra: el
 * integrador dice cuándo es la misma operación y cuándo es otra.
 *
 * Acá vive solo la decisión, sin Prisma ni HTTP, para poder probarla.
 */

/** Lo que hay guardado de una clave. `respuesta` nula = la primera llamada sigue en curso. */
export interface RegistroIdempotente {
  /** Huella del cuerpo con el que se usó la clave la primera vez. */
  huella: string;
  estadoHttp: number | null;
  respuesta: unknown | null;
  expiraEn: Date;
}

export type DecisionIdempotente =
  /** Nunca se vio esta clave (o ya venció): ejecutar y guardar. */
  | { tipo: 'nueva' }
  /** Misma clave, mismo cuerpo, ya respondida: devolver lo guardado sin ejecutar. */
  | { tipo: 'repetida'; estadoHttp: number; respuesta: unknown }
  /** Misma clave, mismo cuerpo, todavía ejecutándose: que reintente en un momento. */
  | { tipo: 'en_curso' }
  /** Misma clave con OTRO cuerpo: es un error del integrador, no un reintento. */
  | { tipo: 'conflicto' };

/** Cuánto vive una clave. El contrato lo publica como 24 horas. */
export const VIGENCIA_IDEMPOTENCIA_MS = 24 * 60 * 60 * 1000;

/**
 * Huella del cuerpo, estable ante el orden de las claves.
 *
 * Hashear el JSON tal como llega haría que `{"a":1,"b":2}` y `{"b":2,"a":1}`
 * —el mismo pedido— dieran huellas distintas, y el reintento legítimo de un
 * cliente cuyo serializador no garantiza orden se rechazaría como conflicto.
 * Por eso se ordena antes: lo que compara es el contenido, no su escritura.
 */
export function huellaDelCuerpo(cuerpo: unknown): string {
  return createHash('sha256').update(canonico(cuerpo)).digest('hex');
}

function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  const pares = Object.keys(obj)
    .sort()
    // `undefined` no sobrevive a JSON: omitirlo iguala al cliente que manda el
    // campo vacío y al que no lo manda, que es lo que el servidor va a ver.
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`);
  return `{${pares.join(',')}}`;
}

/**
 * Qué hacer con esta llamada.
 *
 * Una clave vencida se trata como nueva: pasadas 24 horas, quien repite la
 * misma clave ya no está reintentando nada.
 */
export function decidir(
  registro: RegistroIdempotente | null | undefined,
  huella: string,
  ahora: Date = new Date(),
): DecisionIdempotente {
  if (!registro) return { tipo: 'nueva' };
  if (registro.expiraEn.getTime() <= ahora.getTime()) return { tipo: 'nueva' };
  if (registro.huella !== huella) return { tipo: 'conflicto' };
  if (registro.respuesta === null || registro.estadoHttp === null) {
    return { tipo: 'en_curso' };
  }
  return {
    tipo: 'repetida',
    estadoHttp: registro.estadoHttp,
    respuesta: registro.respuesta,
  };
}

/** Cuándo vence una clave que se guarda ahora. */
export function venceEn(ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() + VIGENCIA_IDEMPOTENCIA_MS);
}

/**
 * ¿La clave que mandó el integrador es usable?
 *
 * Se valida el formato para que una clave vacía o absurdamente larga no llegue
 * a la base. No se exige UUID: el contrato lo recomienda, pero rechazar otra
 * cosa rompería a quien use el id de su propio pedido, que es un uso legítimo
 * y además el mejor.
 */
export function claveValida(clave: unknown): clave is string {
  return typeof clave === 'string' && clave.trim().length > 0 && clave.length <= 128;
}

/**
 * Si una respuesta debe guardarse para futuros reintentos.
 *
 * Solo lo que el servidor decidió: 2xx y los errores del cliente (4xx), que
 * van a repetirse igual. Un 5xx NO se guarda —fue una falla nuestra, pasajera—
 * y el reintento con la misma clave tiene que volver a intentarlo de verdad.
 * Guardarlo dejaría al integrador clavado en un error que ya pasó, sin forma
 * de salir salvo cambiando la clave.
 */
export function debeGuardarse(estadoHttp: number): boolean {
  return estadoHttp < 500;
}
