/**
 * Errores de la Graph API de Meta que significan "este token ya no sirve".
 *
 * Puro: se prueba sin red.
 */

/**
 * Código 190 (OAuthException): la sesión se invalidó (cambiaron la clave de
 * Facebook/Instagram, cerraron sesión en todos lados, quitaron el permiso a la
 * app) o el token venció. Reintentar no sirve: solo un nuevo login lo arregla.
 */
export function esTokenAnulado(err: any): boolean {
  const e = err?.response?.data?.error;
  return Number(e?.code) === 190;
}

/** El mensaje que muestra el panel cuando hay que volver a conectar. */
export function motivoTokenAnulado(err: any): string {
  const e = err?.response?.data?.error;
  return String(e?.error_user_msg || e?.message || 'Meta anuló el acceso.').slice(0, 300);
}
