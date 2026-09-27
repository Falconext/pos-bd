/**
 * El promedio ponderado del costo, tal como lo calcula `actualizarStockYCosto`.
 *
 * Se verifica ANTES de tocar nada: si esta fórmula está mal, cualquier
 * migración a costo por sede hereda el error en las 41 973 filas de stock.
 *
 * El código deja una duda escrita del propio autor —"¿Este es el stock NUEVO
 * total ya actualizado en la línea anterior?"—; esto la responde.
 */

/** Réplica exacta del cálculo del servicio (kardex.service.ts). */
const costoTrasIngreso = (
  stockGlobalDespues: number,
  cantidad: number,
  costoIngreso: number,
  costoAnterior: number,
): number | null => {
  const stockAnteriorGlobal = stockGlobalDespues - cantidad;
  if (stockGlobalDespues <= 0) return null;
  return stockAnteriorGlobal > 0
    ? (stockAnteriorGlobal * costoAnterior + cantidad * costoIngreso) / stockGlobalDespues
    : costoIngreso;
};

describe('Costo promedio ponderado al ingresar mercadería', () => {
  it('el caso normal: 10 a S/100 más 10 a S/140 da S/120', () => {
    // El stock que recibe ya está actualizado: 10 + 10 = 20.
    expect(costoTrasIngreso(20, 10, 140, 100)).toBe(120);
  });

  it('el primer ingreso de un producto sin stock toma el costo de compra', () => {
    expect(costoTrasIngreso(5, 5, 88, 0)).toBe(88);
  });

  it('una bonificación (costo 0) baja el promedio, no lo deja igual', () => {
    // 10 a S/100 + 10 gratis = S/50 promedio.
    expect(costoTrasIngreso(20, 10, 0, 100)).toBe(50);
  });

  it('pondera por cantidad, no promedia a secas', () => {
    // 90 a S/10 = 900, más 10 a S/110 = 1100 → 2000/100 = S/20, no S/60.
    expect(costoTrasIngreso(100, 10, 110, 10)).toBe(20);
  });

  it('con stock global en cero no calcula nada (evita dividir por cero)', () => {
    expect(costoTrasIngreso(0, 0, 50, 30)).toBeNull();
  });

  // ── El borde del stock negativo (sobreventa) ──────────────────────────────
  // No es teórico: 9 empresas tienen "permitir vender sin stock" activo y en
  // producción hay una fila de stock en negativo y 5 productos que terminaron
  // con costo negativo. Sin la guarda, el "valor anterior" negativo distorsiona
  // el ponderado hacia arriba o lo vuelve negativo.

  it('si el stock venía negativo, toma el costo de compra y no lo distorsiona', () => {
    // Sobreventa: el producto estaba en -5. Entran 10 a S/200 → stock 5.
    // Sin la guarda daba S/300, más caro que el precio al que se compró.
    expect(costoTrasIngreso(5, 10, 200, 100)).toBe(200);
  });

  it('nunca produce un costo negativo', () => {
    // Sin la guarda esto daba -S/150.
    expect(costoTrasIngreso(2, 10, 50, 100)).toBe(50);
  });
});
