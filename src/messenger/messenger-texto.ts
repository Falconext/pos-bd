/**
 * Lo que cambia al escribir por Messenger (página de Facebook).
 *
 * Puro: se prueba sin red.
 */

/** Prefijo con que se guarda al cliente de Messenger en `telefonoProspecto`. */
export const PREFIJO_MESSENGER = 'fb:';

export const esDestinoMessenger = (destino: string | null | undefined): boolean =>
  String(destino ?? '').startsWith(PREFIJO_MESSENGER);

/** El id del usuario en la página (PSID) sin el prefijo. */
export const idMessenger = (destino: string): string => String(destino).slice(PREFIJO_MESSENGER.length);

export const destinoMessenger = (psid: string): string => `${PREFIJO_MESSENGER}${psid}`;

/** Messenger acepta hasta 2000 caracteres por mensaje de texto. */
export const LIMITE_BYTES_MESSENGER = 2000;
