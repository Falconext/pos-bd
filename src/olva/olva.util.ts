import {
  planTieneFeature,
  type PlanConFeatures,
} from '../common/utils/plan-features';

// Utilidades puras para normalizar el tracking de Olva.
// Olva devuelve `{ success, data: { status, events[], … } }` con un `status`
// en inglés; aquí lo traducimos a las mismas etapas que ya usa el despacho.

/** Etapas del envío Olva, de la más avanzada a la menos avanzada. */
export const OLVA_ETAPAS = [
  'entregado',
  'destino',
  'reparto',
  'transito',
  'registrado',
] as const;

export type OlvaEstado = (typeof OLVA_ETAPAS)[number];

export interface OlvaDerivado {
  estado: OlvaEstado | null;
  entregado: boolean;
  /** Estado crudo del proveedor (REGISTERED, IN_TRANSIT, …). */
  statusUpstream: string | null;
  ultimoEvento: string | null;
}

/** `status` del proveedor → etapa interna. */
const MAPA_STATUS: Record<string, OlvaEstado> = {
  REGISTERED: 'registrado',
  IN_TRANSIT: 'transito',
  OUT_FOR_DELIVERY: 'reparto',
  READY_FOR_PICKUP: 'destino',
  DELIVERED: 'entregado',
  // Devuelto y rechazado cierran el envío en destino: no son "entregado", pero
  // tampoco siguen en tránsito. Se muestran con su detalle crudo en el modal.
  RETURNED: 'destino',
  REJECTED: 'destino',
};

/** Desenvuelve `{ data: X }` o devuelve el objeto tal cual. */
function unwrap(x: any): any {
  return x?.data ?? x ?? null;
}

/**
 * Deriva la etapa actual y si está entregado a partir del payload de tracking.
 * Tolera tanto la forma envuelta (`{ success, data }`) como la plana.
 */
export function derivarEstadoOlva(trackData: any): OlvaDerivado {
  const data = unwrap(trackData) ?? {};
  const statusUpstream = data?.status ? String(data.status) : null;
  const estado = statusUpstream ? (MAPA_STATUS[statusUpstream] ?? null) : null;

  // Verificado con una guía real: Olva devuelve los eventos del MÁS RECIENTE al
  // más antiguo, así que el último movimiento es el primer elemento.
  const eventos: any[] = Array.isArray(data?.events) ? data.events : [];
  const ultimo = eventos.length ? eventos[0] : null;

  // `deliveredAt` puede venir null aunque el envío esté entregado (verificado con
  // una guía real), así que el `status` es la fuente de verdad.
  const entregado =
    statusUpstream === 'DELIVERED' || Boolean(data?.deliveredAt);

  return {
    estado: entregado ? 'entregado' : estado,
    entregado,
    statusUpstream,
    ultimoEvento: ultimo
      ? String(ultimo.detail ?? ultimo.status ?? '').trim() || null
      : null,
  };
}

/** Etiqueta legible en español de una etapa Olva. */
export function etiquetaEtapaOlva(estado: OlvaEstado | null): string {
  switch (estado) {
    case 'registrado':
      return 'Registrado';
    case 'transito':
      return 'En tránsito';
    case 'reparto':
      return 'En reparto';
    case 'destino':
      return 'En agencia destino';
    case 'entregado':
      return 'Entregado';
    default:
      return 'Sin información';
  }
}

/**
 * Gates de plan. Se leen de las características configuradas en
 * Sistema → Planes (tabla `PlanFeature`), no del nombre del plan: antes esto
 * era `nombrePlan.includes('CORPORAT')` y se rompía al renombrar un plan o al
 * crear uno a medida.
 *
 * `tieneOlva` cubre agencias, rastreo y cotización (los resuelve la API key
 * global). `tieneOlvaGuias` habilita registrar la guía, que consume el cupo de
 * la cuenta Olva — por eso van separados.
 */
export function planPermiteCrearGuiasOlva(plan: PlanConFeatures): boolean {
  return planTieneFeature(plan, 'tieneOlvaGuias');
}

/** Habilita el módulo Olva (rastreo, agencias, cotización). */
export function planPermiteOlva(plan: PlanConFeatures): boolean {
  return planTieneFeature(plan, 'tieneOlva');
}

/**
 * Olva indexa las guías por número + año de emisión (2 dígitos). El número puede
 * venir con el sufijo `-26`; lo separamos para poder pasarlo como `?year=`.
 */
export function separarGuiaOlva(valor: string): {
  numero: string;
  year?: string;
} {
  const raw = String(valor ?? '').trim();
  const m = /^(.+?)-(\d{2})$/.exec(raw);
  if (m) return { numero: m[1], year: m[2] };
  return { numero: raw };
}

/**
 * El proveedor devuelve el envío registrado con distintos nombres según el
 * upstream (`trackingNumber`, `tracking_number`, `guia`, `numero`…). Se extrae
 * de forma tolerante, igual que se hace con Shalom.
 */
export function extraerGuiaOlva(respuesta: any): {
  trackingNumber: string | null;
  sessionId: string | null;
} {
  const d = respuesta?.data ?? respuesta ?? {};
  const tracking =
    d.trackingNumber ??
    d.tracking_number ??
    d.guia ??
    d.guide ??
    d.numero ??
    d.number ??
    d.shipment?.trackingNumber ??
    d.shipment?.tracking_number ??
    null;
  const session =
    d.sessionId ??
    d.session_id ??
    d.cart?.session_id ??
    d.cartSessionId ??
    null;
  return {
    trackingNumber: tracking != null ? String(tracking) : null,
    sessionId: session != null ? String(session) : null,
  };
}
