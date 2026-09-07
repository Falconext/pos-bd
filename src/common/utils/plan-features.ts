/**
 * Lectura de las características del plan (tabla `PlanFeature`).
 *
 * Reemplaza los gates que estaban clavados en código con el nombre del plan
 * (`nombrePlan.includes('CORPORAT')`), que se rompían al renombrar un plan o al
 * crear uno a medida. Ahora manda lo que el administrador marca en
 * Sistema → Planes → Características del plan.
 *
 * El plan puede llegar en dos formas según de dónde se cargó:
 *  - relación cruda de Prisma: `features: [{ featureKey, enabled }]`
 *  - ya resuelto (auth/plan service): `features: { tieneOlva: true, … }`
 * y, si no hay fila para esa clave, se cae a la columna del propio plan —
 * mismo criterio que usa `PlanService.resolvePlanFeatures`.
 */

export type PlanConFeatures =
  | {
      features?:
        | Array<{ featureKey: string; enabled: boolean }>
        | Record<string, boolean>
        | null;
      [columna: string]: any;
    }
  | null
  | undefined;

/** `true` si el plan tiene habilitada la característica. */
export function planTieneFeature(plan: PlanConFeatures, key: string): boolean {
  if (!plan) return false;

  const features = plan.features;

  if (Array.isArray(features)) {
    const fila = features.find((f) => f?.featureKey === key);
    if (fila) return Boolean(fila.enabled);
  } else if (features && typeof features === 'object') {
    if (key in features) return Boolean((features as Record<string, boolean>)[key]);
  }

  // Sin fila para esa clave: cae a la columna homónima del plan (las
  // características viejas viven como columnas en `Plan`). Las nuevas no tienen
  // columna, así que esto devuelve `false` — el default correcto.
  return Boolean(plan[key]);
}

/** Select de Prisma para traer las características junto al plan. */
export const SELECT_PLAN_FEATURES = {
  nombre: true,
  features: { select: { featureKey: true, enabled: true } },
} as const;
