/**
 * Precio que el cliente no pidió.
 *
 * QA de Nicky (Krezka, 23-10): apenas el cliente contaba su problema, la IA
 * ya le soltaba plan y precio ("te va el Emprendedor: S/ 39.90 al mes…"). Con
 * la regla en el contexto bajó de 3 a 2 de cada 9 chats, pero no a cero, y un
 * precio antes de tiempo es lo que hace que el cliente sienta "caro" sin haber
 * visto nada. Por eso lo corta el código.
 *
 * Es opcional por empresa (`precioSoloSiPregunta` en iaVentasConfigJson): en
 * una tienda, decir el precio del producto que el cliente mira es justo lo
 * que hay que hacer.
 */

/**
 * Cualquier forma de preguntar por plata. Amplio a propósito: si el cliente
 * lo insinuó, se le deja el precio; el guardia es para cuando nunca salió.
 */
const PIDE_PRECIO =
  /\b(cu[aá]nto|precios?|costos?|cuesta[n]?|cobran?|sale[n]?|planes|plan|conviene|caro|cara|barato|tarifas?|mensualidad|pagar|pago|inversi[oó]n|cotiza|presupuesto|valor)(?![a-záéíóúñ])/i;

/** "Quiero contratar el Corporativo": ya decidió, el precio le toca. */
// Sin "compras" ni "activo" a secas: un distribuidor habla de sus compras
// todo el rato y eso no es preguntar por el precio de Krezka.
const QUIERE_CONTRATAR =
  /\b(contrat|adquir|suscrib)|\b(lo|la) (compro|activo)\b|\b(comprarlo|activarlo)\b|\bquiero el (plan )?(emprendedor|negocio|corporativo)\b/i;

const MONTO = /S\/\.?\s*\d/i;

export function tieneMonto(texto: string): boolean {
  return MONTO.test(texto);
}

export function pidioPrecio(mensajesDelCliente: string[]): boolean {
  return mensajesDelCliente.some((m) => PIDE_PRECIO.test(m) || QUIERE_CONTRATAR.test(m));
}

/** Hay que sacarle el precio a esta respuesta. */
export function precioNoPedido(respuesta: string, mensajesDelCliente: string[]): boolean {
  return tieneMonto(respuesta) && !pidioPrecio(mensajesDelCliente);
}

/**
 * Plan B, si la reescritura con la IA falla: la respuesta sin las oraciones
 * que dan montos, si el cliente nunca preguntó por precio. Corta en seco
 * (si el precio venía en la misma oración que la solución, se va la
 * solución también); por eso lo primero es reescribir. Si quitar los montos la dejaría vacía, se manda como estaba:
 * peor que un precio adelantado es no contestar.
 */
export function sinPrecioNoPedido(respuesta: string, mensajesDelCliente: string[]): string {
  if (!precioNoPedido(respuesta, mensajesDelCliente)) return respuesta;
  const parrafos = respuesta
    .split(/\n\s*\n/)
    .map((p) =>
      MONTO.test(p)
        ? p
            // "S/. 99.90" no es fin de oración.
            .split(/(?<=[.!?])(?<!S\/\.)\s+/i)
            .filter((o) => !MONTO.test(o))
            .join(' ')
            .trim()
        : p.trim(),
    )
    .filter(Boolean);
  const limpia = parrafos.join('\n\n');
  return limpia && !MONTO.test(limpia) ? limpia : respuesta;
}
