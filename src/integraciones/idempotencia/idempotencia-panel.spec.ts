import { cuerpoParaHuella } from './idempotencia-panel.interceptor';
import { huellaDelCuerpo } from './idempotencia';

describe('huella de una venta del panel', () => {
  const venta = { tipoDoc: 'NV', clienteId: 154, detalles: [{ productoId: 1, cantidad: 2 }] };

  it('el reintento un segundo después es la misma venta', () => {
    const a = huellaDelCuerpo(cuerpoParaHuella({ ...venta, fechaEmision: '2026-10-30T15:07:44' }));
    const b = huellaDelCuerpo(cuerpoParaHuella({ ...venta, fechaEmision: '2026-10-30T15:07:45', claveIdempotencia: 'k' }));
    expect(a).toBe(b);
  });

  it('otro carrito es otra venta', () => {
    const a = huellaDelCuerpo(cuerpoParaHuella(venta));
    const b = huellaDelCuerpo(cuerpoParaHuella({ ...venta, detalles: [{ productoId: 1, cantidad: 3 }] }));
    expect(a).not.toBe(b);
  });
});
