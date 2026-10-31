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

export function destinoDelEnvio(
  envio: { tipoEnvio?: string | null; transportista?: string | null } | null | undefined,
): DestinoEnvio {
  if (envio?.tipoEnvio?.trim().toUpperCase() === 'AGENCIA') return 'AGENCIA';
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
