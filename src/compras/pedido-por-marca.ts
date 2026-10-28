/**
 * Pedido por marca: la tienda multimarca (Ésika, L'Bel, Avon…) le hace un
 * pedido a cada línea en cada campaña. En vez de buscar producto por producto,
 * se cargan todos los de la marca con lo que hace falta para decidir cuánto
 * pedir: stock en la sede, mínimo y lo vendido en los últimos días.
 */

export interface FilaPedidoMarca {
  productoId: number;
  descripcion: string;
  /** "Tono: 170-N" para una variante; null para un producto simple. */
  variante: string | null;
  stock: number;
  stockMinimo: number;
  vendidos: number;
  costo: number;
  tipoAfectacionIGV: string | null;
  sugerido: number;
}

/**
 * Cuánto pedir para cubrir el próximo periodo: lo que se vendió en el periodo
 * anterior, y nunca menos que el mínimo configurado, menos lo que ya hay.
 * Sin ventas ni mínimo no se sugiere nada: pedir a ciegas no es una sugerencia.
 */
export function cantidadSugerida(stock: number, stockMinimo: number, vendidos: number): number {
  const objetivo = Math.max(Number(stockMinimo) || 0, Number(vendidos) || 0);
  const faltan = objetivo - Math.max(0, Number(stock) || 0);
  return faltan > 0 ? Math.ceil(faltan) : 0;
}

/** "Tono: 170-N · Tamaño: 50 ml" a partir de `valoresAtributos`. */
export function etiquetaVariante(valores: unknown): string | null {
  if (!valores || typeof valores !== 'object' || Array.isArray(valores)) return null;
  const partes = Object.entries(valores as Record<string, unknown>)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  return partes.length ? partes.join(' · ') : null;
}
