/**
 * El delivery de un pedido del chat no se factura (2026-10-22). La prueba con
 * base real está en delivery-del-pedido.qa.spec.ts.
 */
import { conObservacionDelivery, esLineaDeDelivery, separarDelivery } from './delivery-del-pedido';

describe('la línea de delivery del bot', () => {
  it('es una línea sin producto que empieza con ENVÍO (con o sin tilde)', () => {
    expect(esLineaDeDelivery({ productoId: null, descripcion: 'ENVÍO DELIVERY' })).toBe(true);
    expect(esLineaDeDelivery({ productoId: null, descripcion: 'Envio Arequipa (agencia)' })).toBe(true);
    expect(esLineaDeDelivery({ productoId: 5, descripcion: 'ENVÍO DELIVERY' })).toBe(false);
    expect(esLineaDeDelivery({ productoId: null, descripcion: 'ENVOLTURA DE REGALO' })).toBe(false);
  });

  it('se separa y se suma lo que valía', () => {
    const r = separarDelivery([
      { productoId: 1, descripcion: 'Moringa', cantidad: 2, nuevoValorUnitario: 31 },
      { productoId: null, descripcion: 'ENVÍO DELIVERY', cantidad: 1, nuevoValorUnitario: 15 },
    ]);
    expect(r.lineas.map((l) => l.descripcion)).toEqual(['Moringa']);
    expect(r.delivery).toBe(15);
    expect(r.descripciones).toEqual(['ENVÍO DELIVERY']);
  });

  it('un pedido de solo envío no se toca: no se puede emitir una boleta vacía', () => {
    const lineas = [{ productoId: null, descripcion: 'ENVÍO DELIVERY', cantidad: 1, nuevoValorUnitario: 15 }];
    expect(separarDelivery(lineas)).toEqual({ lineas, delivery: 0, descripciones: [] });
  });

  it('la observación se agrega a la que había, sin repetirse', () => {
    const una = conObservacionDelivery('Entregar por la tarde', 15, ['ENVÍO DELIVERY']);
    expect(una).toBe('Entregar por la tarde\nENVÍO DELIVERY: S/ 15.00 (servicio de delivery, se cobra aparte y no forma parte del total)');
    expect(conObservacionDelivery(una, 15, ['ENVÍO DELIVERY'])).toBe(una);
  });
});
