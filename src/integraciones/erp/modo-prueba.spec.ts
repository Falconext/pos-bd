import { esPrueba, productoSimulado, ventaSimulada } from './modo-prueba';

describe('modo prueba (sk_test_)', () => {
  it('solo la clave de prueba es prueba', () => {
    expect(esPrueba({ apiKey: { entorno: 'test' } })).toBe(true);
    expect(esPrueba({ apiKey: { entorno: 'live' } })).toBe(false);
    expect(esPrueba({})).toBe(false);
  });

  it('la venta separa el IGV solo de lo gravado', () => {
    const v = ventaSimulada({
      tipo: 'receipt',
      numeroSiguiente: 'B001-12',
      sedeId: 1,
      medioPago: 'card',
      lineas: [
        { productoId: 1, sku: 'A', descripcion: 'Gravado', cantidad: 2, precio: 59, afectacion: '10' },
        { productoId: 2, sku: 'B', descripcion: 'Exonerado', cantidad: 1, precio: 20, afectacion: '20' },
      ],
    });
    expect(v).toMatchObject({ livemode: false, id: null, number: null, number_preview: 'B001-12', status: 'test', total: 138, igv: 18, subtotal: 120 });
  });

  it('el producto simulado no tiene id y conserva lo enviado', () => {
    const p = productoSimulado(
      { descripcion: 'Polo', precioUnitario: 50, tipoAfectacionIGV: '10', moneda: 'PEN', stock: 0, esServicio: false, variantes: [{ valores: { Talla: 'M' }, stock: 3 }] } as any,
      7,
    );
    expect(p).toMatchObject({ livemode: false, id: null, name: 'Polo', tax: 'taxed', location_id: 7 });
    expect(p.variants[0]).toMatchObject({ id: null, attributes: { Talla: 'M' }, stock: 3, price: 50 });
  });
});
