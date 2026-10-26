/**
 * La temperatura del lead (FRÍO/TIBIO/CALIENTE) sale de lo que el cliente
 * HIZO, no de lo que la IA opina de la conversación.
 *
 * Hierba Sana (26-10): "la mayoría los clasifica como caliente, pero el
 * cliente solo deja una consulta y no interactúa". Era cierto y tenía dos
 * causas. El refuerzo de cierre contaba como "dio su nombre" a cualquier par
 * de palabras ("tengo hemorroides") y como "acepta" a cualquier "si" de una
 * pregunta, y con eso el puntaje pasaba de 71 casi siempre. Y la escala BANT
 * (presupuesto, autoridad, plazo) es de venta a empresas: en una tienda
 * naturista la necesidad sale alta desde el primer mensaje.
 *
 * Lo que el negocio llama caliente, en sus palabras: dejó sus datos, agendó
 * su pago, y más aún si ya agendó la entrega. Eso se puede comprobar en la
 * base, así que manda sobre el puntaje: pone un piso cuando hay hechos y un
 * techo cuando no los hay. El puntaje de la IA se mueve dentro de ese rango.
 */

/** Lo que se sabe del cliente, sacado de la base y no del texto. */
export interface HechosLead {
  /** Etapa del embudo (EtapaCrm). */
  etapa: string;
  /** Ya tiene nota de venta registrada: envío o recojo agendado. */
  pedidoRegistrado: boolean;
  /** Recojo en tienda con día y hora avisados. */
  visitaAgendada: boolean;
  /** Dijo una fecha para retomar ("mañana te pago", "cobro el 30"). */
  retomaAgendado: boolean;
  /** Cuántos mensajes escribió el cliente en la conversación. */
  mensajesCliente: number;
}

export interface RangoTemperatura {
  piso: number;
  techo: number;
  /** Por qué está caliente, para el aviso al equipo. Null si no lo está. */
  motivo: string | null;
  /** Si corresponde avisar al equipo cuando llegue a caliente. */
  alertar: boolean;
}

/** Después de esto ya hay un pedido en marcha: el cliente se comprometió. */
const ETAPAS_CON_PEDIDO = new Set([
  'PENDIENTE_VALIDACION_PAGO',
  'POR_DESPACHAR',
  'EN_RUTA',
  'REPROGRAMADO',
]);

/** Desvíos de alguien que dejó de contestar o no compró. */
const ETAPAS_APAGADAS = new Set(['FRIO', 'NO_CONTESTA', 'CONSULTADO_NO_HABIDO']);

/**
 * Hasta dos mensajes es "dejó una consulta": el saludo y la pregunta. Con
 * eso nadie es más que frío, por mucho que la pregunta suene urgente.
 */
const MENSAJES_DE_UNA_CONSULTA = 2;

export function rangoTemperatura(h: HechosLead): RangoTemperatura {
  // Ya compró: es cliente, no lead. No se le pone techo, pero tampoco se avisa
  // de un "lead caliente" que ya está entregado.
  if (h.etapa === 'ENTREGADO') {
    return { piso: 0, techo: 100, motivo: null, alertar: false };
  }
  if (h.visitaAgendada) {
    return { piso: 95, techo: 100, motivo: 'Agendó su visita a la tienda', alertar: true };
  }
  if (h.pedidoRegistrado || ETAPAS_CON_PEDIDO.has(h.etapa)) {
    return { piso: 95, techo: 100, motivo: 'Agendó su entrega', alertar: true };
  }
  if (h.retomaAgendado) {
    return { piso: 85, techo: 100, motivo: 'Agendó fecha para pagar/retomar', alertar: true };
  }
  if (h.etapa === 'DATOS_COMPLETOS') {
    return { piso: 75, techo: 100, motivo: 'Dejó sus datos', alertar: true };
  }
  if (ETAPAS_APAGADAS.has(h.etapa) || h.mensajesCliente <= MENSAJES_DE_UNA_CONSULTA) {
    return { piso: 0, techo: 40, motivo: null, alertar: false };
  }
  // Conversa, incluso ya cotizado, pero no se comprometió a nada: tibio como
  // mucho. Pedir precio no es comprar.
  return { piso: 0, techo: 70, motivo: null, alertar: false };
}

/** Aplica el rango al puntaje de la IA. */
export function ajustarPuntaje(puntaje: number, r: RangoTemperatura): number {
  return Math.max(r.piso, Math.min(r.techo, puntaje));
}
