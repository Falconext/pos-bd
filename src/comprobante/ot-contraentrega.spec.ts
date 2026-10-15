/**
 * La Orden de Trabajo que se cobra CONTRAENTREGA.
 *
 * LINNA MODA lo dijo en una frase: "el cobro lo hago contraentrega, y ya
 * debería ir con la nota de venta creada para programar el envío".
 *
 * La nota tiene que existir ANTES de la entrega, porque es el documento con
 * el que se programa el envío. Se había implementado al revés —exigir la
 * orden cobrada para poder convertirla— y eso dejaba a ese negocio sin
 * ninguna orden convertible: en el panel la opción ni siquiera aparecía.
 *
 * Lo que se defiende acá es la plata. Permitir la conversión con saldo es
 * fácil; lo difícil es que el adelanto no se cobre dos veces ni infle la
 * caja, y que el saldo que queda sea exactamente el que falta.
 */
import { estadoYSaldoInicial } from './estado-pago';

/** Cómo nace la nota al convertir una orden. */
const notaDesdeOrden = (params: {
  total: number;
  yaCobradoEnOrigen: number;
  esCredito: boolean;
}) =>
  estadoYSaldoInicial({
    esCredito: params.esCredito,
    total: params.total,
    yaCobradoEnOrigen: params.yaCobradoEnOrigen,
  });

describe('contraentrega: nada cobrado todavía', () => {
  it('la nota nace debiendo el total entero', () => {
    expect(
      notaDesdeOrden({ total: 240, yaCobradoEnOrigen: 0, esCredito: true }),
    ).toEqual({ estado: 'PENDIENTE_PAGO', saldo: 240 });
  });

  it('queda en cuentas por cobrar, que es lo que se cobra al entregar', () => {
    const r = notaDesdeOrden({
      total: 240,
      yaCobradoEnOrigen: 0,
      esCredito: true,
    });
    expect(r.estado).toBe('PENDIENTE_PAGO');
    expect(r.saldo).toBeGreaterThan(0);
  });
});

describe('con adelanto: lo cobrado en la orden no se cobra dos veces', () => {
  it('el saldo de la nota es lo que falta, no el total', () => {
    // Si no se restara, el cliente pagaría el adelanto otra vez y la caja
    // registraría un ingreso que nunca entró.
    expect(
      notaDesdeOrden({ total: 240, yaCobradoEnOrigen: 60, esCredito: true }),
    ).toEqual({ estado: 'PENDIENTE_PAGO', saldo: 180 });
  });

  it('una orden ya pagada del todo da una nota sin saldo', () => {
    // El caso que SÍ funcionaba antes tiene que seguir funcionando: ampliar
    // la regla no puede romper al taller que cobra por adelantado.
    expect(
      notaDesdeOrden({ total: 240, yaCobradoEnOrigen: 240, esCredito: true }),
    ).toEqual({ estado: 'COMPLETADO', saldo: 0 });
  });

  it('un adelanto mayor que el total no deja saldo negativo', () => {
    // Pasa con un redondeo o con un cambio de precio después del adelanto.
    // Un saldo negativo se leería como que el negocio le debe al cliente.
    expect(
      notaDesdeOrden({ total: 240, yaCobradoEnOrigen: 300, esCredito: true }),
    ).toEqual({ estado: 'COMPLETADO', saldo: 0 });
  });

  it('con céntimos, el saldo cuadra al centavo', () => {
    expect(
      notaDesdeOrden({ total: 24.01, yaCobradoEnOrigen: 10, esCredito: true }),
    ).toEqual({ estado: 'PENDIENTE_PAGO', saldo: 14.01 });
  });
});

describe('una nota al contado sigue siendo al contado', () => {
  it('sin crédito no hay saldo, aunque la orden tuviera adelanto', () => {
    // Al contado el cobro entra entero en la emisión: inventarle un saldo
    // dejaría una cuenta por cobrar fantasma.
    expect(
      notaDesdeOrden({ total: 240, yaCobradoEnOrigen: 60, esCredito: false }),
    ).toEqual({ estado: 'COMPLETADO', saldo: 0 });
  });
});
