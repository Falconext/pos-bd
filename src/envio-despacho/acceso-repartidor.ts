/**
 * El enlace con el que el repartidor marca su entrega desde la calle.
 *
 * El problema que resuelve: nadie marcaba los despachos. En Hierba Sana
 * llevaban días todos en PREPARANDO, y con ellos se quedaban sin salir el
 * aviso de entrega al cliente —que ya estaba construido y pagado en su
 * plan— y sin cerrarse el cobro.
 *
 * La razón no era desidia: para marcar una entrega hay que tener usuario con
 * acceso al módulo de Ventas, donde se ven todas las ventas del día con sus
 * montos, sus clientes y sus márgenes. A un motorizado eventual eso no se le
 * puede dar, así que el trabajo caía en alguien de oficina que se enteraba
 * tarde y por WhatsApp.
 *
 * El enlace rompe ese nudo: le abre UN despacho, el suyo, sin cuenta y sin
 * contraseña. Lo que puede hacer es lo mínimo que cierra el ciclo —marcar que
 * salió, marcar que entregó y subir la foto— y nada más: no cobra, no
 * reprograma, no ve otro pedido.
 */
import { randomBytes } from 'crypto';

/** Cuánto sigue abierto el enlace después de entregar. */
export const VIGENCIA_TRAS_ENTREGA_MS = 24 * 60 * 60 * 1000;

/**
 * Un token nuevo.
 *
 * 32 bytes de aleatorio real: el enlace es la única credencial, así que no
 * puede ser adivinable ni derivarse del id del pedido. En base64url porque
 * viaja en una URL que se pega en un WhatsApp.
 */
export function nuevoTokenDeEntrega(): string {
  return randomBytes(32).toString('base64url');
}

export interface DespachoParaAcceso {
  estado: string;
  entregadoEn: Date | null;
}

/**
 * ¿El enlace sigue abierto?
 *
 * Mientras el pedido está en curso, sí: el repartidor lo necesita. Una vez
 * entregado se le da un día más —para que suba una foto que se le quedó o
 * corrija algo— y después se cierra.
 *
 * Por qué no dura para siempre: el enlace muestra nombre, dirección y
 * teléfono del cliente. Si se filtra (y va a andar en los WhatsApp de varios
 * motorizados), lo que queda expuesto es un pedido ya cerrado y por poco
 * tiempo, no la agenda de clientes del negocio.
 *
 * Un despacho DEVUELTO también cierra: no hay nada más que marcar.
 */
export function enlaceVigente(
  despacho: DespachoParaAcceso | null | undefined,
  ahora: Date = new Date(),
): boolean {
  if (!despacho) return false;
  if (despacho.estado === 'DEVUELTO') return false;
  if (despacho.estado !== 'ENTREGADO') return true;
  // Entregado sin fecha: son los despachos que ya existían cuando se agregó
  // el campo. No se les reabre el enlace.
  if (!despacho.entregadoEn) return false;
  return (
    ahora.getTime() - despacho.entregadoEn.getTime() < VIGENCIA_TRAS_ENTREGA_MS
  );
}

/** Los únicos estados que el repartidor puede poner desde el enlace. */
export const ESTADOS_DEL_REPARTIDOR = ['EN_CAMINO', 'ENTREGADO'] as const;
export type EstadoDelRepartidor = (typeof ESTADOS_DEL_REPARTIDOR)[number];

/**
 * ¿Puede poner este estado?
 *
 * La lista es cerrada y corta a propósito. Desde la calle solo tienen sentido
 * dos cosas: "salí con el paquete" y "lo entregué". Devolver un pedido,
 * reprogramarlo o volverlo a preparar son decisiones del negocio, se hacen
 * desde el panel y quedan con el nombre de quién las tomó.
 */
export function puedeMarcar(estado: string): estado is EstadoDelRepartidor {
  return (ESTADOS_DEL_REPARTIDOR as readonly string[]).includes(estado);
}

/**
 * El enlace que se le manda al repartidor.
 *
 * La ruta es la misma que abre la página pública en el frontend.
 */
export function enlaceDeEntrega(base: string, token: string): string {
  return `${String(base).replace(/\/+$/, '')}/entrega/${token}`;
}
