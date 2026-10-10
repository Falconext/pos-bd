/**
 * E1 — el embudo CRM de 12 etapas y el candado de pago.
 *
 * Las etapas son las que Hierba Sana definió en su anexo, con esos nombres y
 * en ese orden. No son una "temperatura" de lead (eso ya existe aparte, en
 * EstadoLeadProspecto: FRÍO/TIBIO/CALIENTE): son el estado OPERATIVO del
 * pedido, lo que el encargado mira para saber qué le toca hacer hoy.
 *
 * El punto no negociable del anexo: *"Ningún pedido pasa a POR_DESPACHAR sin
 * la validación y clic manual del encargado"*. Eso se cumple acá, en las
 * reglas, y no en la pantalla: una regla que solo vive en el botón se salta
 * con una llamada directa a la API.
 */

export enum EtapaCrm {
  NUEVO = 'NUEVO',
  DIAGNOSTICADO = 'DIAGNOSTICADO',
  COTIZADO = 'COTIZADO',
  DATOS_COMPLETOS = 'DATOS_COMPLETOS',
  PENDIENTE_VALIDACION_PAGO = 'PENDIENTE_VALIDACION_PAGO',
  POR_DESPACHAR = 'POR_DESPACHAR',
  EN_RUTA = 'EN_RUTA',
  ENTREGADO = 'ENTREGADO',
  REPROGRAMADO = 'REPROGRAMADO',
  FRIO = 'FRIO',
  NO_CONTESTA = 'NO_CONTESTA',
  CONSULTADO_NO_HABIDO = 'CONSULTADO_NO_HABIDO',
}

/** Quién puede provocar el movimiento. */
export type Actor = 'bot' | 'humano';

/**
 * El avance normal de una venta. Las otras cuatro etapas (REPROGRAMADO, FRIO,
 * NO_CONTESTA, CONSULTADO_NO_HABIDO) no están en esta fila: son desvíos que
 * pueden pasar desde casi cualquier punto.
 */
export const ORDEN_EMBUDO: EtapaCrm[] = [
  EtapaCrm.NUEVO,
  EtapaCrm.DIAGNOSTICADO,
  EtapaCrm.COTIZADO,
  EtapaCrm.DATOS_COMPLETOS,
  EtapaCrm.PENDIENTE_VALIDACION_PAGO,
  EtapaCrm.POR_DESPACHAR,
  EtapaCrm.EN_RUTA,
  EtapaCrm.ENTREGADO,
];

/** Los desvíos: no son retroceso ni avance, son otra cosa que pasó. */
export const DESVIOS: EtapaCrm[] = [
  EtapaCrm.REPROGRAMADO,
  EtapaCrm.FRIO,
  EtapaCrm.NO_CONTESTA,
  EtapaCrm.CONSULTADO_NO_HABIDO,
];

/**
 * Etapas que SOLO puede poner una persona.
 *
 * POR_DESPACHAR es el candado de pago: es el clic con el que el encargado
 * dice "este pago lo vi y está bien". Si el bot pudiera ponerlo, el candado
 * no existiría.
 *
 * REPROGRAMADO también: reprogramar una entrega es un acuerdo con el cliente,
 * no algo que el sistema deduzca.
 */
export const SOLO_HUMANO = new Set<EtapaCrm>([
  EtapaCrm.POR_DESPACHAR,
  EtapaCrm.REPROGRAMADO,
]);

/**
 * Etapas desde las que el pedido puede pasar a despacho.
 *
 * Con adelanto hay voucher y se valida (PENDIENTE_VALIDACION_PAGO). En Lima
 * es contraentrega: no hay nada que validar todavía, así que se despacha
 * desde DATOS_COMPLETOS — pero igual con el clic de una persona, porque la
 * regla del anexo es sobre QUIÉN decide, no sobre si hubo transferencia.
 *
 * REPROGRAMADO también vuelve a despacho: la entrega se reintenta.
 */
export const PUEDEN_IR_A_DESPACHO = new Set<EtapaCrm>([
  EtapaCrm.DATOS_COMPLETOS,
  EtapaCrm.PENDIENTE_VALIDACION_PAGO,
  EtapaCrm.REPROGRAMADO,
]);

/** Etapas finales del recorrido feliz: de acá no se "avanza" más. */
export const TERMINALES = new Set<EtapaCrm>([EtapaCrm.ENTREGADO]);

export interface Veredicto {
  permitido: boolean;
  /** Por qué no, en palabras que se puedan mostrar tal cual. */
  motivo?: string;
}

/**
 * ¿Se puede mover de `desde` a `hacia`?
 *
 * Es deliberadamente permisivo con los desvíos y estricto con el candado: en
 * la calle las cosas pasan en desorden (el cliente paga antes de dar la
 * dirección, pide reprogramar y después contesta), y un embudo que no deja
 * registrar lo que de verdad pasó termina ignorado y lleno de datos falsos.
 * Lo único que no se negocia es quién abre el despacho.
 */
export function puedeMover(
  desde: EtapaCrm,
  hacia: EtapaCrm,
  actor: Actor,
): Veredicto {
  if (desde === hacia) {
    return { permitido: false, motivo: 'El pedido ya está en esa etapa.' };
  }

  if (SOLO_HUMANO.has(hacia) && actor !== 'humano') {
    return {
      permitido: false,
      motivo:
        hacia === EtapaCrm.POR_DESPACHAR
          ? 'Solo una persona puede pasar un pedido a despacho: el pago se valida a mano.'
          : 'Reprogramar una entrega es un acuerdo con el cliente, no lo decide el sistema.',
    };
  }

  if (hacia === EtapaCrm.POR_DESPACHAR && !PUEDEN_IR_A_DESPACHO.has(desde)) {
    return {
      permitido: false,
      motivo:
        'Antes de despachar faltan los datos de entrega y, si hay adelanto, el pago validado.',
    };
  }

  // De ENTREGADO solo se sale a un desvío (un reclamo, una reprogramación por
  // devolución). Volver a "cotizado" un pedido entregado es un error de tipeo.
  if (TERMINALES.has(desde) && !DESVIOS.includes(hacia)) {
    return {
      permitido: false,
      motivo: 'El pedido ya está entregado.',
    };
  }

  return { permitido: true };
}

/**
 * La etapa que corresponde al estado del despacho, para que el embudo no se
 * quede atrás cuando la logística avanza por su lado.
 */
export function etapaDesdeDespacho(estadoDespacho: string): EtapaCrm | null {
  switch (estadoDespacho) {
    case 'EN_CAMINO':
    case 'EN_AGENCIA':
    case 'EN_DESTINO':
      return EtapaCrm.EN_RUTA;
    case 'ENTREGADO':
      return EtapaCrm.ENTREGADO;
    case 'DEVUELTO':
      return EtapaCrm.REPROGRAMADO;
    default:
      return null;
  }
}

/**
 * ¿La etapa nueva es un avance respecto de la actual?
 *
 * Sirve para que los automatismos no hagan retroceder un pedido: si el
 * encargado ya lo pasó a POR_DESPACHAR y después entra una consulta suelta,
 * el bot no debe devolverlo a DIAGNOSTICADO.
 */
export function esAvance(desde: EtapaCrm, hacia: EtapaCrm): boolean {
  const i = ORDEN_EMBUDO.indexOf(desde);
  const j = ORDEN_EMBUDO.indexOf(hacia);

  if (j === -1) {
    // Hacia un desvío. Se registra mientras el pedido no haya entrado todavía
    // en la operación; de ahí en adelante, no.
    //
    // El caso concreto: un cliente con el pedido ya POR_DESPACHAR pregunta por
    // algo que no tenemos. Eso es un dato valioso para reponer —y se guarda
    // igual como consulta—, pero si además le cambiara la etapa, el pedido
    // desaparecería de la columna del encargado y nadie lo despacharía.
    // Mover a un desvío un pedido en marcha lo decide una persona.
    const enLaOperacion = i >= ORDEN_EMBUDO.indexOf(EtapaCrm.DATOS_COMPLETOS);
    return !enLaOperacion;
  }
  // Desde un desvío se retoma el recorrido en cualquier punto.
  if (i === -1) return true;
  return j > i;
}

/** Nombre legible, para el panel y los reportes. */
export const ETIQUETA_ETAPA: Record<EtapaCrm, string> = {
  [EtapaCrm.NUEVO]: 'Nuevo',
  [EtapaCrm.DIAGNOSTICADO]: 'Diagnosticado',
  [EtapaCrm.COTIZADO]: 'Cotizado',
  [EtapaCrm.DATOS_COMPLETOS]: 'Datos completos',
  [EtapaCrm.PENDIENTE_VALIDACION_PAGO]: 'Pago por validar',
  [EtapaCrm.POR_DESPACHAR]: 'Por despachar',
  [EtapaCrm.EN_RUTA]: 'En ruta',
  [EtapaCrm.ENTREGADO]: 'Entregado',
  [EtapaCrm.REPROGRAMADO]: 'Reprogramado',
  [EtapaCrm.FRIO]: 'Frío',
  [EtapaCrm.NO_CONTESTA]: 'No contesta',
  [EtapaCrm.CONSULTADO_NO_HABIDO]: 'Consultó algo que no hay',
};
