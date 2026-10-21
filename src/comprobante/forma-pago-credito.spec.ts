/**
 * Lo que va a SUNAT en una venta al crédito (FormaPago Credito + cuotas).
 *
 * Con pago inicial (21-10) lo pendiente es menos que el total: el monto a
 * crédito tiene que ser la suma de las cuotas, no el importe. Lo de siempre
 * —redondeo absorbido en la última cuota, cuotas que se pasan del total
 * bloqueadas— tiene que seguir igual.
 */
import { formaPagoCredito, SunatPayloadException } from './enviar-sunat.service';

const c = (monto: number) => ({ monto, fechaVencimiento: '2026-10-24' });

it('sin pago inicial: el crédito es el total', () => {
  const r = formaPagoCredito(225, 0, [c(225)]);
  expect(r.montoACredito).toBe(225);
  expect(r.cuotasNormalizadas[0].monto).toBe(225);
});

it('con pago inicial: el crédito es lo pendiente (la suma de las cuotas)', () => {
  const r = formaPagoCredito(243, 0, [c(143)]);
  expect(r.montoACredito).toBe(143);
  expect(r.cuotasNormalizadas[0].monto).toBe(143);
});

it('varias cuotas tras el pago inicial', () => {
  const r = formaPagoCredito(243, 0, [c(70), c(73)]);
  expect(r.montoACredito).toBe(143);
});

it('un céntimo de redondeo se absorbe en la última cuota', () => {
  const r = formaPagoCredito(1096.63, 0, [c(548.32), c(548.32)]);
  expect(r.montoACredito).toBe(1096.63);
  expect(r.cuotasNormalizadas[1].monto).toBe(548.31);
});

it('cuotas que se pasan del total siguen bloqueadas', () => {
  expect(() => formaPagoCredito(225, 0, [c(300)])).toThrow(SunatPayloadException);
});

it('con detracción, el crédito es el total menos la detracción', () => {
  const r = formaPagoCredito(1180, 118, [c(1062)]);
  expect(r.montoACredito).toBe(1062);
});
