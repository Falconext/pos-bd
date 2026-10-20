/**
 * Registrar sin volver a preguntar cuando el cliente ya aceptó.
 *
 * Prueba del 20-10 (NV01-00000025): la clienta dijo "si agendalo" antes de
 * ver la cotización, mandó todos sus datos, y el bot le mostró la cotización
 * con "¿Deseas que agendemos tu entrega?". El pedido quedó colgado hasta un
 * segundo "sí", y un cliente de Lima que ya respondió todo no siempre vuelve.
 */

/** Frases con las que el cliente acepta agendar. */
const ACEPTA =
  /\b(ag[eé]nd[ae]l[oa]s?|ag[eé]ndame(l[oa]s?)?|ag[eé]ndelo|res[eé]rv[ae]l[oa]|confirmo|lo quiero|la quiero|los quiero|env[ií][ae]melo|m[aá]nd[ae]melo|tr[aá]emelo)\b/i;

/** ¿Alguno de estos mensajes del cliente acepta agendar el pedido? */
export function yaAceptoAntes(mensajesDelCliente: string[]): boolean {
  return mensajesDelCliente.some((m) => ACEPTA.test(m ?? ''));
}

/**
 * La respuesta sin la pregunta de cierre, más la confirmación del registro.
 * La pregunta sobra: el pedido ya quedó registrado.
 */
export function conRegistroDirecto(
  respuesta: string,
  pedido: string,
  montoAPagar?: number,
): string {
  const lineas = respuesta.split('\n');
  while (lineas.length && !lineas.at(-1)!.trim()) lineas.pop();
  const ultima = lineas.at(-1) ?? '';
  if (/\?\s*$/.test(ultima)) {
    // "Esta sería la cotización completa… ¿Deseas que agendemos?": se queda
    // la cotización y se va la frase de cierre entera.
    lineas.pop();
  }
  const monto =
    montoAPagar != null && montoAPagar > 0
      ? ` El pago es contraentrega: S/ ${montoAPagar.toFixed(2)} al recibir.`
      : '';
  return `${lineas.join('\n').trimEnd()}\n\nListo, tu pedido quedó registrado con el número ${pedido}.${monto} Te avisamos antes de llegar.`;
}
