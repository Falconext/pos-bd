import { DashboardService } from './dashboard.service';

/**
 * "Ventas por Canal" del dashboard: un comprobante MIXTO (pagado con más de
 * un medio, ej. parte efectivo + parte Yape) no tiene un solo medio de pago
 * — antes se amontonaba entero en "Otros"; ahora se reparte usando las filas
 * reales de `Pago`.
 */
describe('DashboardService.ventasPorCanalPen', () => {
  const crear = (pagos: any[]) => {
    const s = Object.create(DashboardService.prototype) as any;
    s.prisma = { pago: { findMany: jest.fn().mockResolvedValue(pagos) } };
    return s;
  };

  it('un comprobante MIXTO se reparte entre efectivo y yape, no cae en Otros', async () => {
    const s = crear([
      {
        monto: 3,
        medioPago: 'EFECTIVO',
        comprobante: { tipoMoneda: 'PEN', tipoCambio: 1 },
      },
      {
        monto: 9.9,
        medioPago: 'YAPE',
        comprobante: { tipoMoneda: 'PEN', tipoCambio: 1 },
      },
    ]);
    const ventasCanalRows = [
      {
        medioPago: 'MIXTO',
        tipoMoneda: 'PEN',
        tipoCambio: 1,
        _sum: { mtoImpVenta: 12.9 },
      },
      {
        medioPago: 'EFECTIVO',
        tipoMoneda: 'PEN',
        tipoCambio: 1,
        _sum: { mtoImpVenta: 100 },
      },
    ];
    const r = await s.ventasPorCanalPen(ventasCanalRows, {});
    expect(r).toEqual({
      sumTarjeta: 0,
      sumTransferencia: 0,
      sumRedes: 9.9,
      sumEfectivo: 103,
      sumOtros: 0,
    });
  });

  it('sin comprobantes MIXTO, no consulta Pago', async () => {
    const s = crear([]);
    const r = await s.ventasPorCanalPen(
      [
        {
          medioPago: 'TARJETA',
          tipoMoneda: 'PEN',
          tipoCambio: 1,
          _sum: { mtoImpVenta: 50 },
        },
      ],
      {},
    );
    expect(r.sumTarjeta).toBe(50);
    expect(s.prisma.pago.findMany).not.toHaveBeenCalled();
  });

  it('un MIXTO sin filas de Pago (dato incompleto) no desaparece: cae a Otros', async () => {
    const s = crear([]); // ninguna fila de Pago registrada para este comprobante
    const ventasCanalRows = [
      {
        medioPago: 'MIXTO',
        tipoMoneda: 'PEN',
        tipoCambio: 1,
        _sum: { mtoImpVenta: 20 },
      },
    ];
    const r = await s.ventasPorCanalPen(ventasCanalRows, {});
    expect(r.sumOtros).toBe(20);
  });
});
