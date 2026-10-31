/**
 * ¿El despacho es un delivery local (Lima, motorizado propio) o un envío a
 * provincia por agencia (Shalom, Olva, …)?
 *
 * Cliente, 31-10: "para clientes de Lima envío otro tipo de mensaje tanto de
 * en camino y cuando llega, no es lo mismo texto para provincia". El aviso
 * "en camino" de Lima habla del motorizado; el de provincia, de la agencia.
 * Con esto se elige qué texto del negocio sale. Puro, para probarlo sin base.
 */

/** Couriers que dejan el paquete en una agencia (o reparten en provincia). */
export const COURIERS_AGENCIA: ReadonlySet<string> = new Set([
  'SHALOM_PRO',
  'SHALOM_COD',
  'OLVA',
  'URBANO',
  'CRUZ_SUR',
  'MARVISUR',
]);

export type DestinoEnvio = 'LOCAL' | 'AGENCIA';

/**
 * Manda el tipo de envío que se eligió al registrarlo (es obligatorio en POS y
 * en el despacho): "Para agencia" → el cliente recoge con su clave; "A
 * domicilio" → se lo llevan a su puerta, sea el motorizado en Lima o Olva en
 * provincia (así un Olva a domicilio no recibe "ya puedes recogerlo en la
 * agencia"). Solo los envíos antiguos sin tipo se deciden por el courier.
 */
export function destinoDelEnvio(
  envio: { tipoEnvio?: string | null; transportista?: string | null } | null | undefined,
): DestinoEnvio {
  const tipo = envio?.tipoEnvio?.trim().toUpperCase();
  if (tipo === 'AGENCIA') return 'AGENCIA';
  if (tipo === 'DOMICILIO') return 'LOCAL';
  const courier = envio?.transportista?.trim().toUpperCase() ?? '';
  return COURIERS_AGENCIA.has(courier) ? 'AGENCIA' : 'LOCAL';
}

/**
 * El texto que escribió el negocio para ese destino. La variante de agencia
 * es opcional: vacía o sin escribir → sale el texto general, como siempre.
 */
export function textoSegunDestino(
  destino: DestinoEnvio,
  general: string | null | undefined,
  agencia: string | null | undefined,
): string | null | undefined {
  return destino === 'AGENCIA' && agencia?.trim() ? agencia : general;
}
