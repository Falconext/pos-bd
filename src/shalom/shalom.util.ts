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
