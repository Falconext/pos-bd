/**
 * El celular de la entrega no es el del chat.
 *
 * Hierba Sana (26-10): clientes que escriben desde un WhatsApp sin número a
 * la vista (usuario @nick) o que, al dar los datos para Shalom, ponen el
 * número de un familiar. Nadie lo notaba: la entrega se coordinaba con un
 * número que el negocio creía del cliente, y el cliente no sabía que lo iban
 * a llamar a otro. Ahora se distingue y se le avisa.
 */

const nueve = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-9);

/** El chat trae un teléfono de verdad (no Instagram ni un @nick de WhatsApp). */
export function chatConTelefono(telefonoChat: string): boolean {
  return /^\+?\d{9,15}$/.test((telefonoChat ?? '').trim());
}

/** El celular dado para la entrega es otro número que el del chat. */
export function esOtroNumero(celular: string, telefonoChat: string): boolean {
  const c = nueve(celular);
  if (c.length < 9) return false;
  if (!chatConTelefono(telefonoChat)) return true;
  return c !== nueve(telefonoChat);
}

/** Lo que el modelo tiene que decirle al cliente, una sola vez. */
export function avisoOtroNumero(celular: string, telefonoChat: string): string {
  const numero = nueve(celular);
  if (!chatConTelefono(telefonoChat)) {
    return (
      `Este chat no muestra el número del cliente: el ${numero} queda como el contacto para la entrega. ` +
      `Dile en una línea que coordinaremos la entrega y el seguimiento del envío con el ${numero}.`
    );
  }
  return (
    `El celular ${numero} no es el número de este chat. Dile en una línea que coordinaremos la entrega y el seguimiento del envío con el ${numero}. ` +
    'Si es de otra persona (un familiar que recibe), pregúntale su nombre y guárdalo en recibeNombre.'
  );
}

/** La línea del celular en la nota del pedido, marcando si es de otro. */
export function lineaCelular(celular: string, telefonoChat: string, recibeNombre?: string | null): string {
  if (!esOtroNumero(celular, telefonoChat)) return `Celular: ${celular}`;
  const de = recibeNombre ? ` (de ${recibeNombre})` : '';
  return chatConTelefono(telefonoChat)
    ? `Celular para la entrega: ${celular}${de} — NO es el WhatsApp del chat (${telefonoChat})`
    : `Celular para la entrega: ${celular}${de} — el chat no muestra el número del cliente`;
}
