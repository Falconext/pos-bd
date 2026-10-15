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

/**
 * Las cuotas que el origen trae viejas.
 *
 * Pasa por un camino que nosotros mismos le recomendamos al cliente: emitir
 * la orden al crédito y cobrar el adelanto después, en Gestión de Pagos.
 * `pago.service` actualiza el `saldo` del comprobante pero NO sus `cuotas`,
 * así que la orden queda con un cronograma calculado para el total viejo.
 *
 * Al convertir, heredar ese cronograma tal cual mataba la emisión con "La
 * suma de cuotas (S/ 275.00) debe ser igual al saldo a crédito (S/ 205.00)"
 * — un error que el usuario no puede resolver, porque nunca escribió esas
 * cuotas: se las generó el POS.
 */
const cuotasParaElSaldo = (
  saldo: number,
  cuotas: { monto: number; fechaVencimiento?: string }[] | undefined,
  fechaVencimientoCredito?: string,
) => {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const lista = Array.isArray(cuotas) ? cuotas : [];
  if (lista.length === 0) return cuotas;
  const suma = r2(lista.reduce((a, c) => a + Number(c?.monto ?? 0), 0));
  if (Math.abs(suma - r2(saldo)) <= 0.01) return cuotas;
  const fecha = lista[0]?.fechaVencimiento ?? fechaVencimientoCredito;
  if (r2(saldo) <= 0) return [];
  return [{ monto: r2(saldo), fechaVencimiento: fecha }];
};

describe('cuotas heredadas de la orden', () => {
  const VIEJAS = [{ monto: 275, fechaVencimiento: '2026-10-16' }];

  it('si ya no suman el saldo, se rehacen por el saldo real', () => {
    expect(cuotasParaElSaldo(205, VIEJAS)).toEqual([
      { monto: 205, fechaVencimiento: '2026-10-16' },
    ]);
  });

  it('conserva la fecha pactada: lo viejo es el monto, no el plazo', () => {
    const r = cuotasParaElSaldo(205, VIEJAS) as any[];
    expect(r[0].fechaVencimiento).toBe('2026-10-16');
  });

  it('si ya cuadran, no se tocan', () => {
    // Es el caso de LINNA MODA hoy: el adelanto se tomó en la emisión, así
    // que el POS ya escribió la cuota por el saldo.
    const buenas = [{ monto: 105, fechaVencimiento: '2026-10-24' }];
    expect(cuotasParaElSaldo(105, buenas)).toBe(buenas);
  });

  it('sin saldo no queda ninguna cuota: el documento nace cobrado', () => {
    expect(cuotasParaElSaldo(0, VIEJAS)).toEqual([]);
  });

  it('sin cuotas en el origen no inventa ninguna', () => {
    expect(cuotasParaElSaldo(205, undefined)).toBeUndefined();
    expect(cuotasParaElSaldo(205, [])).toEqual([]);
  });

  it('varias cuotas que ya no suman se colapsan en una por el saldo', () => {
    const tres = [
      { monto: 100, fechaVencimiento: '2026-11-01' },
      { monto: 100, fechaVencimiento: '2026-12-01' },
      { monto: 75, fechaVencimiento: '2027-01-01' },
    ];
    expect(cuotasParaElSaldo(205, tres)).toEqual([
      { monto: 205, fechaVencimiento: '2026-11-01' },
    ]);
  });
});
