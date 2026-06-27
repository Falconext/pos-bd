/**
 * Helper para detectar funcionalidades automáticamente según el rubro
 * Esto elimina la necesidad de una tabla de configuración
 */

export interface RubroFeatures {
  gestionLotes: boolean; // Farmacia/Botica
  requiereVencimientos: boolean; // Farmacia/Alimentos
  usaCodigoBarras: boolean; // Bodega/Supermarket
  permiteFraccionamiento: boolean; // Farmacia
  gestionOfertas: boolean; // Supermarket
  controlStock: boolean; // Todos (siempre true)
}

type FeatureOverrides = {
  usaCodigoBarrasManual?: boolean | null;
};

/**
 * Detecta automáticamente las funcionalidades según el nombre del rubro
 */
export function detectarFuncionesRubro(
  nombreRubro: string,
  overrides?: FeatureOverrides,
): RubroFeatures {
  const nombre = nombreRubro.toLowerCase();

  // FARMACIA / BOTICA / MEDICAMENTOS
  const esFarmacia =
    nombre.includes('farmacia') ||
    nombre.includes('botica') ||
    nombre.includes('medicament');

  // BODEGA / SUPERMARKET / MINIMARKET
  const esBodega =
    nombre.includes('bodega') ||
    nombre.includes('supermarket') ||
    nombre.includes('supermercado') ||
    nombre.includes('minimarket') ||
    nombre.includes('abarrotes');

  // ALIMENTOS (restaurante, panadería, etc.)
  const esAlimentos =
    nombre.includes('restaurante') ||
    nombre.includes('panadería') ||
    nombre.includes('panaderia') ||
    nombre.includes('pastelería') ||
    nombre.includes('pasteleria');

  // FABRICACIÓN / MANUFACTURA
  const esFabricacion =
    nombre.includes('fabricación') ||
    nombre.includes('fabricacion') ||
    nombre.includes('manufactura') ||
    nombre.includes('industria') ||
    nombre.includes('producción') ||
    nombre.includes('produccion');

  const usaCodigoBarras =
    typeof overrides?.usaCodigoBarrasManual === 'boolean'
      ? overrides.usaCodigoBarrasManual
      : esBodega;

  return {
    // Lotes: Farmacia y fabricación (insumos/componentes)
    gestionLotes: esFarmacia || esFabricacion,

    // Vencimientos: Farmacia y alimentos
    requiereVencimientos: esFarmacia || esAlimentos,

    // Código de barras: Bodega/Supermarket
    usaCodigoBarras,

    // Fraccionamiento (venta por unidad de caja): Farmacia
    permiteFraccionamiento: esFarmacia,

    // Ofertas/Promociones: Supermarket
    gestionOfertas: esBodega,

    // Control de stock: TODOS
    controlStock: true,
  };
}

/**
 * Versión simplificada para saber si usa lotes
 */
export function usaLotes(nombreRubro: string): boolean {
  const nombre = nombreRubro.toLowerCase();
  return (
    nombre.includes('farmacia') ||
    nombre.includes('botica') ||
    nombre.includes('medicament') ||
    nombre.includes('fabricación') ||
    nombre.includes('fabricacion') ||
    nombre.includes('manufactura') ||
    nombre.includes('industria') ||
    nombre.includes('producción') ||
    nombre.includes('produccion')
  );
}

/**
 * Versión simplificada para saber si usa código de barras
 */
export function usaCodigoBarras(nombreRubro: string): boolean {
  const nombre = nombreRubro.toLowerCase();
  return (
    nombre.includes('bodega') ||
    nombre.includes('supermarket') ||
    nombre.includes('supermercado') ||
    nombre.includes('minimarket')
  );
}
