/**
 * Un mismo cliente, dos conversaciones.
 *
 * Hierba Sana, 23-10: Erica escribió con su @usuario de WhatsApp, sin número
 * a la vista (Meta manda el BSUID "PE.1602…" en vez del teléfono). Compró por
 * el bot y dio su celular para la entrega. Cuando el aviso de despacho salió
 * a ese celular, Meta empezó a mandar sus mensajes CON el número, y el
 * sistema abrió una conversación nueva: el bot de la segunda no tenía la
 * charla de la primera, y Edwing veía dos chats.
 *
 * Cuando llega un número que todavía no tiene conversación se busca la del
 * mismo cliente con su BSUID —el que trae el propio mensaje o, si no, la
 * conversación sin número que dejó ese celular en sus datos de entrega— y se
 * le pone el número. Todo lo de acá es puro.
 */

/** ¿Es un número de teléfono (y no un BSUID "PE.…")? */
export const esTelefono = (s: string | null | undefined) => /^\+?\d{8,15}$/.test(String(s ?? ''));

/** Los 9 dígitos del celular peruano. */
export const nueveDigitos = (s: string | null | undefined) => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
};

export interface ConversacionSinNumero {
  id: number;
  telefonoProspecto: string;
  /** Celular que dio para la entrega (borrador del pedido). */
  celularEntrega?: string | null;
}

/**
 * A cuál conversación sin número le corresponde este teléfono. Por el BSUID
 * del mensaje si viene; si no, por el celular de entrega, y solo si hay UNA
 * que calce (con dos no se adivina).
 */
export function conversacionDelMismoCliente(
  telefono: string,
  bsuid: string | null | undefined,
  candidatas: ConversacionSinNumero[],
): number | null {
  if (!esTelefono(telefono)) return null;
  if (bsuid) {
    const porBsuid = candidatas.find((c) => c.telefonoProspecto === bsuid);
    if (porBsuid) return porBsuid.id;
  }
  const nueve = nueveDigitos(telefono);
  const porCelular = candidatas.filter(
    (c) => !esTelefono(c.telefonoProspecto) && nueve && nueveDigitos(c.celularEntrega) === nueve,
  );
  return porCelular.length === 1 ? porCelular[0].id : null;
}
