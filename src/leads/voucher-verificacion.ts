/**
 * ¿La captura de pago cuadra con lo que el negocio espera?
 *
 * Prueba con un Yape real (19-10): S/ 500 a "Steysy Deu*" para un adelanto de
 * S/ 50 que debía ir a Edwing Tony Cayo Huerta. La IA respondió "Recibido" y
 * se inventó "tienes un saldo a favor de S/ 450 para tu próxima compra". El
 * dinero nunca le llegó al negocio, y el saldo a favor no existe.
 *
 * Esto no se deja al criterio del modelo: el código compara y, si algo no
 * cuadra, le dice qué hacer.
 */

function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * ¿El nombre de la captura es el del titular del negocio?
 *
 * Yape enmascara el apellido ("Edwing Cay*"), así que basta con que una
 * palabra de la captura empiece igual que una del titular. Sin texto de
 * referencia no se puede saber: se da por bueno.
 */
export function nombreCoincide(
  nombreCaptura: string | null | undefined,
  referencia: string | null | undefined,
): boolean {
  if (!nombreCaptura?.trim() || !referencia?.trim()) return true;
  const ref = normalizar(referencia).split(/[^a-z]+/).filter((w) => w.length >= 3);
  const cap = normalizar(nombreCaptura)
    .split(/[^a-z*]+/)
    .map((w) => w.replace(/\*+$/, ''))
    .filter((w) => w.length >= 3);
  return cap.some((c) => ref.some((r) => r.startsWith(c) || c.startsWith(r)));
}

/**
 * Lo que hay que decirle al modelo si la captura no cuadra, o null si cuadra.
 */
export function avisoVoucher(p: {
  monto: number | null | undefined;
  nombre: string | null | undefined;
  referenciaTitular: string | null | undefined;
  pendiente: number | null | undefined;
}): string | null {
  const problemas: string[] = [];
  if (!nombreCoincide(p.nombre, p.referenciaTitular)) {
    problemas.push(
      `el pago figura a nombre de ${p.nombre}, que no es el titular de la cuenta del negocio`,
    );
  }
  if (
    p.monto != null &&
    p.pendiente != null &&
    p.pendiente > 0 &&
    p.monto > p.pendiente + 0.01
  ) {
    problemas.push(
      `el monto (S/ ${p.monto.toFixed(2)}) es mayor a lo que falta pagar (S/ ${p.pendiente.toFixed(2)})`,
    );
  }
  if (!problemas.length) return null;
  return (
    `[verificación del sistema: ${problemas.join('; ')}. ` +
    'NO confirmes el pago ni digas que lo recibiste. No ofrezcas saldo a favor, devoluciones ni créditos. ' +
    'Dile con amabilidad lo que no coincide y que el equipo lo va a revisar antes de despachar.]'
  );
}

/**
 * El titular de la cuenta tal como lo escribió el negocio ("Yape 955 947 892,
 * titular Edwing Tony Cayo Huerta"). Se busca la frase y no el texto entero:
 * contra un contexto de miles de palabras cualquier nombre "coincidiría".
 */
export function extraerTitular(texto: string | null | undefined): string | null {
  const m = /\b(?:titular|a nombre de)\b\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,4})/i.exec(
    texto ?? '',
  );
  return m ? m[1].trim() : null;
}
