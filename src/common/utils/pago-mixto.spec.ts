import { lineasPagoMixto } from './pago-mixto';

describe('lineasPagoMixto', () => {
  it('solo aplica a MIXTO', () => {
    expect(lineasPagoMixto({ medioPago: 'EFECTIVO', pagos: [{ medioPago: 'EFECTIVO', monto: 5 }] })).toEqual([]);
  });

  it('usa paymentDetails.splitPayments (también si viene como texto)', () => {
    const paymentDetails = JSON.stringify({ splitPayments: [{ method: 'efectivo', amount: 20 }, { method: 'YAPE', amount: 16 }] });
    expect(lineasPagoMixto({ medioPago: 'MIXTO', paymentDetails })).toEqual([
      { medio: 'EFECTIVO', monto: 20 },
      { medio: 'YAPE', monto: 16 },
    ]);
  });

  it('sin detalle, agrupa las filas de Pago por medio', () => {
    expect(
      lineasPagoMixto({
        medioPago: 'mixto',
        paymentDetails: null,
        pagos: [
          { medioPago: 'EFECTIVO', monto: 10 },
          { medioPago: 'YAPE', monto: 16 },
          { medioPago: 'EFECTIVO', monto: 10 },
        ],
      }),
    ).toEqual([
      { medio: 'EFECTIVO', monto: 20 },
      { medio: 'YAPE', monto: 16 },
    ]);
  });
});
