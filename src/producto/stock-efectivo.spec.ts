import { cumpleFiltroStock, stockEfectivoDeProducto } from './stock-efectivo';

describe('stockEfectivoDeProducto', () => {
  const p = {
    stock: 9, // global descuadrado: no debe usarse si hay filas por sede
    stockMinimo: 5,
    porcentajeProvision: 0,
    stocks: [
      { stock: 2, stockMinimo: 5 },
      { stock: 0, stockMinimo: 5 },
    ],
  };

  it('con sede usa solo la fila de esa sede', () => {
    const e = stockEfectivoDeProducto({ ...p, stocks: [p.stocks[0]] }, 18, 0);
    expect(e.stockDisponibleVenta).toBe(2);
    expect(e.stockMinimo).toBe(5);
  });

  it('sin sede suma las sedes y no el stock global', () => {
    const e = stockEfectivoDeProducto(p, null, 0);
    expect(e.stockDisponibleVenta).toBe(2);
    expect(e.stockMinimo).toBe(10);
  });

  it('descuenta lo reservado', () => {
    const e = stockEfectivoDeProducto({ ...p, stocks: [{ stock: 6, stockMinimo: 5 }] }, 18, 4);
    expect(e.stockDisponibleVenta).toBe(2);
  });
});

describe('cumpleFiltroStock', () => {
  const e = (s: number, min = 5) => ({ stockDisponibleVenta: s, stockMinimo: min });

  it('BAJO exige mínimo configurado', () => {
    expect(cumpleFiltroStock(e(2), 'BAJO')).toBe(true);
    expect(cumpleFiltroStock(e(5), 'BAJO')).toBe(true);
    expect(cumpleFiltroStock(e(6), 'BAJO')).toBe(false);
    expect(cumpleFiltroStock(e(0, 0), 'BAJO')).toBe(false);
  });

  it('SIN_STOCK', () => {
    expect(cumpleFiltroStock(e(0), 'SIN_STOCK')).toBe(true);
    expect(cumpleFiltroStock(e(1), 'SIN_STOCK')).toBe(false);
  });

  it('RANGO inclusivo, con extremos opcionales', () => {
    expect(cumpleFiltroStock(e(5), 'RANGO', 5, 6)).toBe(true);
    expect(cumpleFiltroStock(e(6), 'RANGO', 5, 6)).toBe(true);
    expect(cumpleFiltroStock(e(7), 'RANGO', 5, 6)).toBe(false);
    expect(cumpleFiltroStock(e(100), 'RANGO', 50, null)).toBe(true);
    expect(cumpleFiltroStock(e(3), 'RANGO', null, 3)).toBe(true);
  });
});
