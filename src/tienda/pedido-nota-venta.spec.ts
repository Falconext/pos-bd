import { cobroDeNotaVenta, lineasDeNotaVenta, transportistaDelPedido } from './pedido-nota-venta';

const total = (ls: any[]) => Math.round(ls.reduce((a, l) => a + l.cantidad * l.nuevoValorUnitario, 0) * 100) / 100;

describe('pedido → nota de venta', () => {
  const base = { tipoEntrega: 'ENVIO', envioCourier: 'SHALOM', envioAgenciaNombre: 'AV. JAVIER PRADO - LIMA', items: [
    { productoId: 1, cantidad: 2, precioUnit: 50, subtotal: 100 },
    { productoId: 2, cantidad: 1, precioUnit: 30, subtotal: 30 },
  ] };

  it('líneas = productos y cierra en el total', () => {
    const ls = lineasDeNotaVenta({ ...base, total: 130, costoEnvio: 0 });
    expect(ls).toHaveLength(2);
    expect(ls[0]).toEqual({ productoId: 1, cantidad: 2, nuevoValorUnitario: 50 });
    expect(total(ls)).toBe(130);
  });

  it('el envío que paga el cliente va como línea', () => {
    const ls = lineasDeNotaVenta({ ...base, total: 142, costoEnvio: 12 });
    expect(ls[2]).toMatchObject({ productoId: null, nuevoValorUnitario: 12, unidad: 'ZZ' });
    expect(String(ls[2].descripcion)).toContain('SHALOM');
    expect(total(ls)).toBe(142);
  });

  it('un cupón se reparte para cerrar en el total del pedido', () => {
    const ls = lineasDeNotaVenta({ ...base, total: 117, costoEnvio: 0 });
    expect(total(ls)).toBe(117);
  });

  it('combos van con comboId', () => {
    const ls = lineasDeNotaVenta({ ...base, total: 40, costoEnvio: 0, items: [{ productoId: 9, cantidad: 1, precioUnit: 40, subtotal: 40, esCombo: true, comboId: 7 }] });
    expect(ls[0]).toMatchObject({ comboId: 7, productoId: null });
  });

  it('cobro: sin adelanto, parcial y completo', () => {
    expect(cobroDeNotaVenta(100, 0, 'YAPE')).toEqual({ formaPagoTipo: 'CREDITO', porCobrar: 100, adelanto: 0 });
    expect(cobroDeNotaVenta(100, 40, 'YAPE')).toEqual({ formaPagoTipo: 'CREDITO', adelanto: 40, medioPago: 'YAPE', porCobrar: 60 });
    expect(cobroDeNotaVenta(100, 100, 'EFECTIVO')).toMatchObject({ formaPagoTipo: 'CONTADO', porCobrar: 0 });
    expect(cobroDeNotaVenta(100, 150, 'EFECTIVO')).toMatchObject({ formaPagoTipo: 'CONTADO' });
  });

  it('courier del despacho', () => {
    expect(transportistaDelPedido({ ...base, total: 0, costoEnvio: 0 })).toBe('SHALOM_PRO');
    expect(transportistaDelPedido({ ...base, envioCourier: 'OLVA', total: 0, costoEnvio: 0 })).toBe('OLVA');
    expect(transportistaDelPedido({ ...base, envioCourier: null, agenciaEnvio: 'SHALOM_COD', total: 0, costoEnvio: 0 })).toBe('SHALOM_COD');
    expect(transportistaDelPedido({ ...base, envioCourier: null, agenciaEnvio: null, total: 0, costoEnvio: 0 })).toBe('PROPIOS');
  });
});
