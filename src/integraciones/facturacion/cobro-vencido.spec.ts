import { estaVencido, finDelDiaLima, mensajeCobroVencido } from './cobro-vencido';

/**
 * "Desde el primer día de vencido no puede emitir" (25-10). El día es de
 * Lima: un cobro que vence el 17 deja emitir todo el 17 y corta el 18.
 */
describe('cobro vencido', () => {
  // Creado el 2 a las 10:00 de Lima + 15 días = vence el 17 a las 10:00 de Lima.
  const vence = new Date('2026-11-17T15:00:00Z');

  it('el día del vencimiento todavía se puede emitir, hasta las 23:59 de Lima', () => {
    expect(estaVencido(vence, new Date('2026-11-17T20:00:00Z'))).toBe(false); // 3 p. m. Lima
    expect(estaVencido(vence, new Date('2026-11-18T04:59:59Z'))).toBe(false); // 11:59:59 p. m. Lima
  });

  it('desde las 00:00 de Lima del día siguiente está vencido', () => {
    expect(estaVencido(vence, new Date('2026-11-18T05:00:00Z'))).toBe(true);
  });

  it('el fin del día no se corre por la hora UTC', () => {
    // 2 a. m. UTC del 18 sigue siendo el 17 en Lima.
    expect(finDelDiaLima(new Date('2026-11-18T02:00:00Z')).toISOString()).toBe('2026-11-18T04:59:59.999Z');
  });

  it('el mensaje dice cuánto se debe y dónde pagar', () => {
    const m = mensajeCobroVencido([{ periodo: '2026-10', monto: 5.9 }, { periodo: '2026-11', monto: 1.18 }]);
    expect(m).toContain('2026-10, 2026-11: S/ 7.08');
    expect(m).toContain('/console/consumo');
    expect(m).toMatch(/anulaciones siguen funcionando/);
  });
});
