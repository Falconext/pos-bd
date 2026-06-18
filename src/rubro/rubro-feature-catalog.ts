export const RUBRO_FEATURE_CATALOG = [
  {
    key: 'controlStock',
    label: 'Control de stock',
    description: 'Muestra inventario, stock mínimo y alertas básicas.',
    group: 'Inventario',
  },
  {
    key: 'usaCodigoBarras',
    label: 'Código de barras',
    description: 'Muestra y prioriza campos de código de barras.',
    group: 'Inventario',
  },
  {
    key: 'gestionLotes',
    label: 'Gestión de lotes',
    description: 'Habilita lotes, trazabilidad y salidas FEFO/LIFO.',
    group: 'Inventario',
  },
  {
    key: 'requiereVencimientos',
    label: 'Vencimientos',
    description: 'Muestra vencimientos y alertas de caducidad.',
    group: 'Inventario',
  },
  {
    key: 'permiteFraccionamiento',
    label: 'Fraccionamiento',
    description: 'Permite vender cajas por unidades.',
    group: 'Ventas',
  },
  {
    key: 'gestionOfertas',
    label: 'Ofertas',
    description: 'Muestra configuración de promociones/ofertas.',
    group: 'Ventas',
  },
  {
    key: 'fichaTecnicaComputo',
    label: 'Ficha técnica de cómputo',
    description: 'Modelo, part number, compatibilidad y especificaciones.',
    group: 'Cómputo',
  },
  {
    key: 'controlSeriesGarantia',
    label: 'Series y garantía',
    description: 'Permite exigir número de serie por unidad vendida.',
    group: 'Cómputo',
  },
  {
    key: 'descripcionRica',
    label: 'Descripción Rica de Producto',
    description: 'Activa editor rich text para fichas técnicas y descripciones largas en la tienda virtual.',
    group: 'Tienda',
  },
] as const;

export type RubroFeatureKey = (typeof RUBRO_FEATURE_CATALOG)[number]['key'];

export function getRubroFeatureKeys(): RubroFeatureKey[] {
  return RUBRO_FEATURE_CATALOG.map((feature) => feature.key);
}
