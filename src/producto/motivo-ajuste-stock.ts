/**
 * Los motivos de un ajuste manual de stock, en palabras.
 *
 * Espejo de `frontend/src/features/admin/kardex/products/motivoAjusteStock.ts`:
 * el POS elige el código, el backend lo convierte en la frase que queda
 * guardada en el kardex. Se traduce acá y no en la pantalla para que el
 * historial sea legible desde cualquier lado —un export, un reporte, la app
 * móvil— sin depender de que el cliente sepa descifrar "MERMA".
 */

const ETIQUETAS: Record<string, string> = {
  // Salidas
  MERMA: 'Merma (producto roto o dañado)',
  VENCIDO: 'Vencido o en mal estado',
  CONSUMO_INTERNO: 'Consumo interno del negocio',
  PERDIDA: 'Pérdida o robo',
  DEVOLUCION_PROVEEDOR: 'Devolución al proveedor',
  // Ingresos
  ENCONTRADO: 'Encontrado en inventario',
  DEVOLUCION_CLIENTE: 'Devolución de un cliente',
  CONTEO: 'Corrección por conteo físico',
  // Ambos
  ERROR_REGISTRO: 'Error de registro anterior',
  OTRO: 'Otro motivo',
};

/**
 * La frase del motivo, o vacío si no vino ninguno.
 *
 * Un código desconocido se devuelve tal cual en vez de descartarse: es
 * preferible un kardex que diga algo raro a uno que no diga nada, que es el
 * problema que esto vino a resolver.
 */
export const etiquetaDeMotivo = (codigo?: string | null): string => {
  const c = String(codigo ?? '').trim().toUpperCase();
  if (!c) return '';
  return ETIQUETAS[c] ?? c;
};
