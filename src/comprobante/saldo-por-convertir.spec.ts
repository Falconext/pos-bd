import { excesosSobreSaldo, lineasPorConvertir, totalDeLineas } from './saldo-por-convertir';

// Caso real (IRBA, empresa 90): NV01-1 por S/755.80 con 5 productos; la
// clienta quiso 3 con factura (F0A1-1, S/418.80) y 2 con boleta.
const linea = (productoId: number, descripcion: string, cantidad: number, precio: number) => {
  const total = cantidad * precio;
  const valor = Math.round((total / 1.18) * 100) / 100;
  return {
    productoId,
    descripcion,
    cantidad,
    mtoPrecioUnitario: precio,
    mtoValorVenta: valor,
    mtoBaseIgv: valor,
    igv: Math.round((total - valor) * 100) / 100,
    totalImpuestos: Math.round((total - valor) * 100) / 100,
  };
};

const nv = [
  linea(32293, 'COMPLEJO B 50 SOBRES X 12 GR', 2, 42.5),
  linea(32295, 'COMPLEJO B 100 GR', 24, 6.2),
  linea(32296, 'COMPLEJO B 1 KG', 6, 22),
  linea(32251, 'POLLON PREMIUM 100G', 12, 11.5),
  linea(32273, 'TRUENO PLUS 50 ML', 24, 10.5),
];
const factura = [
  linea(32251, 'POLLON PREMIUM 100G', 12, 11.5),
  linea(32296, 'COMPLEJO B 1 KG', 6, 22),
  linea(32295, 'COMPLEJO B 100 GR', 24, 6.2),
];

describe('saldo por convertir de una nota', () => {
  it('lo que falta son los 2 productos que no fueron a la factura (S/337)', () => {
    const pend = lineasPorConvertir(nv, factura);
    expect(pend.map((l) => l.descripcion)).toEqual([
      'COMPLEJO B 50 SOBRES X 12 GR',
      'TRUENO PLUS 50 ML',
    ]);
    expect(totalDeLineas(pend)).toBe(337);
  });

  it('la boleta por el saldo cabe; otra factura con lo ya emitido no', () => {
    const pend = lineasPorConvertir(nv, factura);
    expect(excesosSobreSaldo(pend, pend)).toEqual([]);
    expect(excesosSobreSaldo(pend, [linea(32251, 'POLLON PREMIUM 100G', 1, 11.5)])).toEqual([
      'POLLON PREMIUM 100G: ya no queda por convertir',
    ]);
    expect(excesosSobreSaldo(pend, [linea(32273, 'TRUENO PLUS 50 ML', 25, 10.5)])).toEqual([
      'TRUENO PLUS 50 ML: quedan 24, se pidió 25',
    ]);
  });

  it('nota convertida completa: no queda nada', () => {
    expect(lineasPorConvertir(nv, nv)).toEqual([]);
  });

  it('cantidad partida: queda la diferencia con los montos escalados', () => {
    const pend = lineasPorConvertir(nv, [linea(32273, 'TRUENO PLUS 50 ML (editado)', 10, 10.5)]);
    const trueno = pend.find((l) => l.productoId === 32273)!;
    expect(trueno.cantidad).toBe(14);
    expect(trueno.mtoPrecioUnitario).toBe(10.5);
    expect(Math.round((trueno.mtoValorVenta + trueno.igv) * 100) / 100).toBe(147);
  });

  it('ítem libre se reconoce por descripción', () => {
    const nota = [{ productoId: null, descripcion: 'Servicio de armado', cantidad: 1, mtoValorVenta: 50, igv: 9 }];
    expect(lineasPorConvertir(nota, [{ productoId: null, descripcion: ' servicio de armado ', cantidad: 1 }])).toEqual([]);
  });
});
