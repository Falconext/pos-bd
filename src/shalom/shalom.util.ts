import {
  planTieneFeature,
  type PlanConFeatures,
} from '../common/utils/plan-features';

// Utilidades puras para normalizar el tracking de Shalom.
// Ambos proveedores (legacy y lat) terminan devolviendo una forma
// { search, statuses, ose_id }; aquí derivamos la etapa actual del envío.

// Etapas del envío, de la más avanzada a la menos avanzada. El estado actual
// es la primera (más avanzada) que tenga fecha registrada.
export const SHALOM_ETAPAS = [
  'entregado',
  'destino',
  'transito',
  'origen',
  'registrado',
] as const;

export type ShalomEstado = (typeof SHALOM_ETAPAS)[number];

export interface ShalomDerivado {
  estado: ShalomEstado | null;
  entregado: boolean;
  oseId: string | null;
}

/** Desenvuelve `{ data: X }` o devuelve el objeto tal cual. */
function unwrap(x: any): any {
  return x?.data ?? x ?? null;
}

/**
 * Deriva la etapa actual, si está entregado y el ose_id a partir del payload
 * de tracking (tolerante a las dos formas de proveedor).
 */
export function derivarEstadoShalom(trackData: any): ShalomDerivado {
  const search = unwrap(trackData?.search);
  const statuses = unwrap(trackData?.statuses) ?? {};

  let estado: ShalomEstado | null = null;
  for (const etapa of SHALOM_ETAPAS) {
    if (statuses?.[etapa]?.fecha) {
      estado = etapa;
      break;
    }
  }

  const entregado =
    Boolean(statuses?.entregado?.fecha) || Boolean(search?.entregado);
  if (entregado) estado = 'entregado';

  const oseId =
    trackData?.ose_id ??
    trackData?.order?.ose_id ??
    search?.ose_id ??
    null;

  return { estado, entregado, oseId: oseId != null ? String(oseId) : null };
}

/** Etiqueta legible en español de una etapa Shalom. */
export function etiquetaEtapaShalom(estado: ShalomEstado | null): string {
  switch (estado) {
    case 'registrado':
      return 'Registrado';
    case 'origen':
      return 'En origen';
    case 'transito':
      return 'En tránsito';
    case 'destino':
      return 'En agencia destino';
    case 'entregado':
      return 'Entregado';
    default:
      return 'Sin información';
  }
}

/**
 * Gate de plan, leído de las características configuradas en Sistema → Planes
 * (tabla `PlanFeature`) y ya no del nombre del plan, que se rompía al renombrar
 * o al crear planes a medida.
 *
 * El rastreo (`tieneShalom`) va con la API key global; crear guías consume la
 * cuenta Shalom Pro del negocio, por eso es una característica aparte.
 */
export function planPermiteShalomPro(plan: PlanConFeatures): boolean {
  return planTieneFeature(plan, 'tieneShalomGuias');
}

/** Habilita el módulo Shalom (rastreo, agencias, comprobante, etiqueta). */
export function planPermiteShalom(plan: PlanConFeatures): boolean {
  return planTieneFeature(plan, 'tieneShalom');
}
