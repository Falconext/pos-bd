import { num } from '../common/utils/stock';

/**
 * Stock que el Kardex muestra para un producto y el mínimo contra el que se
 * compara. Vive aparte porque lo usan el listado (para pintar la columna) y el
 * filtro de stock (para decidir qué productos entran): si cada uno lo calculara
 * a su manera, "Stock bajo" del dashboard y el Kardex vuelven a no coincidir.
 */
export interface FilaStockProducto {
  stock?: unknown;
  stockMinimo?: number | null;
  porcentajeProvision?: number | null;
  /** Filas de ProductoStock: solo la de la sede pedida, o todas sin sede. */
  stocks: { stock?: unknown; stockMinimo?: number | null }[];
  lotes?: { stockActual?: unknown }[];
}

export function stockEfectivoDeProducto(
  p: FilaStockProducto,
  sedeId: number | null | undefined,
  reservado: number,
) {
  const stockDesdeLotes = (p.lotes || []).reduce(
    (acc, lote) => acc + Number(lote.stockActual || 0),
    0,
  );
  const usaStockLotes = stockDesdeLotes > 0;
  // Con sede: SOLO el stock de esa sede (sin fila ProductoStock = 0).
  // Sin sede: la suma de sedes; el stock global solo si no hay filas.
  const stockTotalBase = sedeId
    ? num(p.stocks[0]?.stock)
    : p.stocks.length > 0
      ? p.stocks.reduce((sum, s) => sum + num(s.stock), 0)
      : num(p.stock);
  // Los lotes no tienen sede: su suma solo vale para el total de la empresa.
  const stockTotal = usaStockLotes && !sedeId ? stockDesdeLotes : stockTotalBase;
  const stockMinimo = sedeId
    ? (p.stocks[0]?.stockMinimo ?? 0)
    : p.stocks.length > 0
      ? p.stocks.reduce((sum, s) => sum + (s.stockMinimo || 0), 0)
      : (p.stockMinimo ?? 0);
  const cupoProvision = Math.floor(
    (stockTotal * (p.porcentajeProvision ?? 0)) / 100,
  );
  const cupoVenta = Math.max(0, stockTotal - cupoProvision);
  const stockDisponibleVenta = Math.max(
    0,
    Math.min(stockTotal - reservado, cupoVenta),
  );
  return { usaStockLotes, stockTotal, stockMinimo, stockDisponibleVenta };
}

export type FiltroStock = 'BAJO' | 'SIN_STOCK' | 'RANGO';

/**
 * BAJO: tiene mínimo configurado y está en o por debajo de él.
 * SIN_STOCK: nada disponible para vender.
 * RANGO: disponible entre `desde` y `hasta` (cualquiera de los dos puede faltar).
 */
export function cumpleFiltroStock(
  e: { stockDisponibleVenta: number; stockMinimo: number },
  filtro: FiltroStock,
  desde?: number | null,
  hasta?: number | null,
): boolean {
  const s = e.stockDisponibleVenta;
  if (filtro === 'BAJO') return e.stockMinimo > 0 && s <= e.stockMinimo;
  if (filtro === 'SIN_STOCK') return s <= 0;
  if (desde != null && s < desde) return false;
  if (hasta != null && s > hasta) return false;
  return true;
}
