/**
 * Pago mixto al contado (22-10): S/ 300 de la caja y S/ 200 por Yape a un
 * proveedor. Cada parte con su método; si no, el cierre de caja descuadra.
 */
import { pagosIniciales } from './pagos-iniciales';

describe('pagos con los que nace una compra', () => {
  it('pago mixto: una fila por método, en mayúsculas y sin montos en cero', () => {
    const pagos = pagosIniciales(
      {
        pagosIniciales: [
          { metodo: 'efectivo', monto: 300 },
          { metodo: 'TRANSFERENCIA', monto: 200, cuentaBancariaId: 4, referencia: ' 00123 ' },
          { metodo: 'YAPE', monto: 0 },
        ],
      },
      500,
      false,
    );
    expect(pagos).toEqual([
      { metodo: 'EFECTIVO', monto: 300, cuentaBancariaId: undefined, referencia: undefined },
      { metodo: 'TRANSFERENCIA', monto: 200, cuentaBancariaId: 4, referencia: '00123' },
    ]);
  });

  it('si las partes suman más que la factura, se rechaza en vez de recortar', () => {
    expect(() =>
      pagosIniciales({ pagosIniciales: [{ metodo: 'EFECTIVO', monto: 300 }, { metodo: 'YAPE', monto: 250 }] }, 500, false),
    ).toThrow('Los pagos suman S/ 550.00 y la compra es de S/ 500.00.');
  });

  it('un centavo de redondeo entre filas no lo rechaza', () => {
    const pagos = pagosIniciales(
      { pagosIniciales: [{ metodo: 'EFECTIVO', monto: 166.67 }, { metodo: 'YAPE', monto: 333.34 }] },
      500,
      false,
    );
    expect(pagos).toHaveLength(2);
  });

  it('pagar menos que el total deja saldo: es un pago parcial, no un error', () => {
    const pagos = pagosIniciales({ pagosIniciales: [{ metodo: 'EFECTIVO', monto: 100 }] }, 500, false);
    expect(pagos.reduce((a, p) => a + p.monto, 0)).toBe(100);
  });

  it('sin pago mixto, todo como antes: un pago y nunca más que el total', () => {
    expect(
      pagosIniciales({ montoPagadoInicial: 600, metodoPagoInicial: 'YAPE', referenciaInicial: 'op1' }, 500, false),
    ).toEqual([{ metodo: 'YAPE', monto: 500, cuentaBancariaId: undefined, referencia: 'op1' }]);
    expect(pagosIniciales({ montoPagadoInicial: 0 }, 500, false)).toEqual([]);
    expect(pagosIniciales({ montoPagadoInicial: 80 }, 500, false)[0].metodo).toBe('EFECTIVO');
  });

  it('una compra que espera aprobación no nace pagada', () => {
    expect(pagosIniciales({ pagosIniciales: [{ metodo: 'EFECTIVO', monto: 500 }] }, 500, true)).toEqual([]);
  });
});
