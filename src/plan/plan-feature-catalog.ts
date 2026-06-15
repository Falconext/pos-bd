export type PlanFeatureKey =
  | 'esPrueba'
  | 'tieneTienda'
  | 'tieneBanners'
  | 'tieneGaleria'
  | 'tieneCulqi'
  | 'tieneDeliveryGPS'
  | 'tieneTicketera'
  | 'tieneGestionLotes'
  | 'tieneGestionProvisiones';

export interface PlanFeatureCatalogItem {
  key: PlanFeatureKey;
  label: string;
  description: string;
  group: 'general' | 'tienda' | 'ventas' | 'operaciones' | 'inventario';
  icon: string;
  dependsOn?: PlanFeatureKey;
  limits?: Array<{
    key: 'maxBanners' | 'maxImagenesProducto' | 'maxComprobantes' | 'maxSedes' | 'limiteUsuarios';
    label: string;
    hint?: string;
  }>;
}

export const PLAN_FEATURE_CATALOG: PlanFeatureCatalogItem[] = [
  {
    key: 'esPrueba',
    label: 'Plan de Prueba (Gratuito)',
    description: 'Permite identificar planes trial y controlar promociones o onboarding.',
    group: 'general',
    icon: 'solar:gift-bold-duotone',
  },
  {
    key: 'tieneTienda',
    label: 'Tienda Virtual',
    description: 'Activa catálogo público, pedidos online y configuración de tienda.',
    group: 'tienda',
    icon: 'solar:shop-bold-duotone',
    limits: [
      { key: 'maxBanners', label: 'Máx. banners', hint: '0 desactiva banners; vacío mantiene el valor actual.' },
      { key: 'maxImagenesProducto', label: 'Máx. imágenes/producto' },
    ],
  },
  {
    key: 'tieneBanners',
    label: 'Banners Publicitarios',
    description: 'Permite administrar banners de tienda y campañas visuales.',
    group: 'tienda',
    icon: 'solar:gallery-wide-bold-duotone',
    dependsOn: 'tieneTienda',
  },
  {
    key: 'tieneGaleria',
    label: 'Galería de Imágenes',
    description: 'Habilita galerías comerciales para productos y negocio.',
    group: 'tienda',
    icon: 'solar:gallery-bold-duotone',
    dependsOn: 'tieneTienda',
  },
  {
    key: 'tieneCulqi',
    label: 'Pasarela Pagos (Culqi)',
    description: 'Activa pagos online con tarjeta en tienda virtual.',
    group: 'tienda',
    icon: 'solar:card-bold-duotone',
    dependsOn: 'tieneTienda',
  },
  {
    key: 'tieneDeliveryGPS',
    label: 'Delivery GPS Tracker',
    description: 'Habilita trazabilidad, despacho y seguimiento de entregas.',
    group: 'operaciones',
    icon: 'solar:routing-3-bold-duotone',
  },
  {
    key: 'tieneTicketera',
    label: 'Ticketera (Impresión Térmica)',
    description: 'Permite formatos ticket 80mm y flujos de impresión térmica.',
    group: 'ventas',
    icon: 'solar:printer-bold-duotone',
  },
  {
    key: 'tieneGestionLotes',
    label: 'Gestión de Lotes',
    description: 'Activa lotes, vencimientos, FEFO y control farmacéutico/inventario avanzado.',
    group: 'inventario',
    icon: 'solar:box-minimalistic-bold-duotone',
  },
  {
    key: 'tieneGestionProvisiones',
    label: 'Gestión de Provisiones',
    description: 'Habilita costos provisionados y análisis avanzado de rentabilidad.',
    group: 'inventario',
    icon: 'solar:chart-square-bold-duotone',
  },
];

export function getPlanFeatureKeys(): PlanFeatureKey[] {
  return PLAN_FEATURE_CATALOG.map((feature) => feature.key);
}
