import { repartirPago, saldoTotal } from './cobro-varias';

describe('cobrar varias notas de un cliente', () => {
  const notas = [
    { id: 3, saldo: 40, fechaEmision: '2026-10-19T10:00:00Z' },
    { id: 1, saldo: 45, fechaEmision: '2026-10-10T10:00:00Z' },
    { id: 2, saldo: 0, fechaEmision: '2026-10-12T10:00:00Z' },
    { id: 4, saldo: 13.5, fechaEmision: '2026-10-20T10:00:00Z' },
  ];

  it('el pago completo salda todas, de la más antigua a la más nueva', () => {
    expect(saldoTotal(notas)).toBe(98.5);
    expect(repartirPago(notas, 98.5)).toEqual([
      { id: 1, monto: 45 },
      { id: 3, monto: 40 },
      { id: 4, monto: 13.5 },
    ]);
  });

  it('un pago parcial cubre primero lo más antiguo y deja a cuenta la siguiente', () => {
    expect(repartirPago(notas, 60.1)).toEqual([
      { id: 1, monto: 45 },
      { id: 3, monto: 15.1 },
    ]);
  });

  it('no cobra de más ni acepta 0', () => {
    expect(() => repartirPago(notas, 98.51)).toThrow('98.50');
    expect(() => repartirPago(notas, 0)).toThrow('mayor a 0');
  });

  it('no arrastra errores de decimales', () => {
    const r = repartirPago([{ id: 1, saldo: 0.1, fechaEmision: '2026-01-01' }, { id: 2, saldo: 0.2, fechaEmision: '2026-01-02' }], 0.3);
    expect(r).toEqual([{ id: 1, monto: 0.1 }, { id: 2, monto: 0.2 }]);
  });
});
