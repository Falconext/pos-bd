/**
 * El modelo escribe en Markdown y WhatsApp no lo entiende.
 *
 * Hierba Sana, 23-10: la dirección de la tienda llegó como
 * "**Av. Emancipación 687…**". En WhatsApp la negrita es *un* asterisco, así
 * que al cliente le quedaban los asteriscos sueltos a la vista. Se traduce en
 * código, justo antes de guardar y enviar, para todos los negocios.
 */
export function enFormatoWhatsapp(texto: string): string {
  return (
    texto
      // **negrita** / __negrita__ → *negrita*
      .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '*$1*')
      .replace(/__(?=\S)([^_\n]+?)(?<=\S)__/g, '*$1*')
      // ~~tachado~~ → ~tachado~
      .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, '~$1~')
      // "### Título" → "*Título*"
      .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '*$1*')
      // [texto](https://…) → "texto: https://…" (WhatsApp no tiene enlaces con nombre)
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t: string, url: string) =>
        t.trim() === url ? url : `${t}: ${url}`,
      )
      // Lo que quede de "**" sin pareja tampoco se ve bien.
      .replace(/\*{2,}/g, '*')
  );
}
