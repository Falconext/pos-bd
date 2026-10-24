/**
 * Cómo le paga el cliente al recibir, según quién le lleva el pedido.
 *
 * Hierba Sana, 24-10: con un repartidor del equipo se acepta todo (efectivo,
 * Yape, transferencia, ZIPAGO); con uno contratado, todo menos efectivo y
 * solo a las cuentas del negocio, nunca al Yape del repartidor. Y el cliente
 * tiene que enterarse en el mismo aviso que le dice quién va.
 *
 * El texto lo escribe cada negocio (Automatización de despacho); acá solo se
 * elige cuál va y se deja apto para una variable de plantilla de WhatsApp,
 * que no admite saltos de línea, tabulaciones ni más de 4 espacios seguidos.
 */

export type TipoRepartidor = 'PLANILLA' | 'EVENTUAL';

export function textoParaPlantilla(t: string | null | undefined): string {
  return String(t ?? '')
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/ {2,}/g, ' ')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .slice(0, 300);
}

/** Las formas de pago que van en el aviso, o null si no corresponde decir nada. */
export function formasDePagoParaElAviso(
  tipo: TipoRepartidor | string | null | undefined,
  config: { pagoRepartidorPropio?: string | null; pagoRepartidorContratado?: string | null } | null | undefined,
): string | null {
  if (!tipo) return null;
  const texto = tipo === 'PLANILLA' ? config?.pagoRepartidorPropio : config?.pagoRepartidorContratado;
  const limpio = textoParaPlantilla(texto);
  return limpio || null;
}
