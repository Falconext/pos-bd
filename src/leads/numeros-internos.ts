/**
 * Los números del propio negocio que prueban el bot.
 *
 * Hierba Sana lo pidió así: "Estilo colecta no debe figurar en el flujo".
 * El dueño y su equipo escriben al WhatsApp del negocio haciéndose pasar por
 * clientes para ver cómo responde la IA —es la única forma de probarla—, y
 * cada una de esas pruebas quedaba en el embudo como un lead más. En el
 * tablero de Hierba Sana, dos de las tres conversaciones eran pruebas: una
 * desde el número del propio supervisor, con puntaje 82, y otra con 96.
 *
 * Un embudo con leads falsos no es un detalle estético: es la pantalla donde
 * el negocio decide a quién llamar primero.
 *
 * La regla: a un número interno la IA le responde igual —si no, no se podría
 * probar— pero no se le crea prospecto, no se le califica y no se dispara la
 * alerta de lead caliente. Nadie necesita que le avisen de sí mismo.
 */

/**
 * La parte del número que sirve para comparar: los últimos 9 dígitos.
 *
 * El mismo teléfono vive escrito de tres formas distintas en la base. El
 * celular del usuario se guarda como lo tecleó una persona ("955947892"),
 * WhatsApp manda siempre el internacional ("51955947892") y a mano aparece
 * con espacios o con "+". Comparar las cadenas tal cual no acierta nunca.
 */
export function claveTelefono(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}

/**
 * ¿Este número es del propio negocio?
 *
 * Vacío nunca es interno: un prospecto sin teléfono no puede confundirse con
 * el dueño, y tratarlo como interno lo borraría del embudo.
 */
export function esNumeroInterno(
  telefono: string | null | undefined,
  internos: readonly (string | null | undefined)[],
): boolean {
  const clave = claveTelefono(telefono);
  if (!clave) return false;
  return internos.some((n) => claveTelefono(n) === clave);
}

/**
 * La lista de números internos de una empresa, sin repetidos ni vacíos.
 *
 * Son dos fuentes: los celulares de sus administradores —que ya están
 * cargados y son los que prueban— y los que el negocio agregue a mano en su
 * configuración, para el resto del equipo o para un número de pruebas que no
 * pertenece a ningún usuario del sistema.
 */
export function numerosInternos(
  celularesDeAdmins: readonly (string | null | undefined)[],
  configurados: readonly (string | null | undefined)[] = [],
): string[] {
  const vistos = new Set<string>();
  for (const n of [...celularesDeAdmins, ...configurados]) {
    const clave = claveTelefono(n);
    if (clave) vistos.add(clave);
  }
  return [...vistos];
}
