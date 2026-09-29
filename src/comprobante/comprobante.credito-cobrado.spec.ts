/**
 * El saldo de una venta a crédito cuando parte ya se cobró.
 *
 * Reportado por OWENSOFT: la nota de venta NV01-297 era a crédito pero ya
 * estaba cobrada entera (S/280 de S/280, estadoPago COMPLETADO, saldo 0). Al
 * convertirla a boleta, el saldo se calculaba por el TOTAL —sin descontar lo ya
 * cobrado—, el sistema pedía un cronograma por plata que el cliente ya había
 * pagado y la emisión moría con "todas las cuotas deben tener monto mayor a
 * cero". No había forma de emitir el documento.
 */

// Se importa la función REAL del servicio: una prueba que reimplementa la regla
// no prueba el código que corre en producción.
import { estadoYSaldoInicial as estadoYSaldo } from './estado-pago';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

describe('Crédito ya cobrado al convertir un informal', () => {
  it('EL CASO DE OWENSOFT: cobrado entero, saldo cero y venta completada', () => {
    expect(estadoYSaldo({ esCredito: true, total: 280, yaCobradoEnOrigen: 280 }))
      .toEqual({ estado: 'COMPLETADO', saldo: 0 });
  });

  it('antes del arreglo el saldo salía por el total', () => {
    // Con saldo 280 el sistema exigía cronograma; la cuota real era 0 y reventaba.
    const viejo = Math.max(0, round2(280 - 0));
    expect(viejo).toBe(280);
  });

  it('cobrado a medias deja pendiente solo la diferencia', () => {
    expect(estadoYSaldo({ esCredito: true, total: 280, yaCobradoEnOrigen: 100 }))
      .toEqual({ estado: 'PENDIENTE_PAGO', saldo: 180 });
  });

  it('sin nada cobrado el saldo es el total, como siempre', () => {
    expect(estadoYSaldo({ esCredito: true, total: 280 }))
      .toEqual({ estado: 'PENDIENTE_PAGO', saldo: 280 });
  });

  it('la detracción se sigue descontando, junto con lo cobrado', () => {
    expect(estadoYSaldo({ esCredito: true, total: 1000, detraccion: 120, yaCobradoEnOrigen: 300 }))
      .toEqual({ estado: 'PENDIENTE_PAGO', saldo: 580 });
  });

  it('si cobraron de más el saldo no se va a negativo', () => {
    expect(estadoYSaldo({ esCredito: true, total: 280, yaCobradoEnOrigen: 300 }).saldo).toBe(0);
  });

  it('una venta al contado no cambia: saldo cero y completada', () => {
    // La garantía de que esto no le toca nada a las ventas normales.
    expect(estadoYSaldo({ esCredito: false, total: 280 }))
      .toEqual({ estado: 'COMPLETADO', saldo: 0 });
  });

  it('redondea a dos decimales', () => {
    expect(estadoYSaldo({ esCredito: true, total: 100.555, yaCobradoEnOrigen: 0.005 }).saldo)
      .toBe(100.55);
  });
});
