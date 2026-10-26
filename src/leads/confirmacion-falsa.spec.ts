import { afirmaPagoVerificado, afirmaPedidoRegistrado, sinConfirmacionFalsa, sinPagoInventado } from './confirmacion-falsa';
import { HERRAMIENTA_REGISTRAR_PEDIDO } from './leads-herramientas';

const fallo = (resultado: unknown) => [
  { nombre: HERRAMIENTA_REGISTRAR_PEDIDO, argumentos: {}, resultado },
];

describe('el asesor no confirma un pedido que no se registró', () => {
  it('reconoce las formas en que lo dice', () => {
    expect(afirmaPedidoRegistrado('Tu pedido ha quedado registrado con éxito')).toBe(true);
    expect(afirmaPedidoRegistrado('¡Listo! Tu pedido quedó agendado para mañana')).toBe(true);
    expect(afirmaPedidoRegistrado('Muchas gracias, se ha agendado tu pedido.')).toBe(true);
    expect(afirmaPedidoRegistrado('¿Deseas que agendemos tu entrega?')).toBe(false);
  });

  it('caso real del 19-10: faltaba la sede y dijo que quedó registrado', () => {
    const r = sinConfirmacionFalsa(
      'He recibido tu adelanto de S/ 20.00. Tu pedido ha quedado registrado con éxito.',
      fallo({ falta: ['la sede de la agencia donde recogerá'] }),
      false,
    );
    expect(r).toBe(
      'Para dejar tu pedido registrado solo me falta la sede de la agencia donde recogerá. ¿Me lo confirmas, por favor?',
    );
  });

  it('si el pedido sí está registrado, no toca nada', () => {
    const texto = 'Tu pedido quedó registrado con el código NV01-00000010.';
    expect(sinConfirmacionFalsa(texto, [], true)).toBe(texto);
  });

  it('sin lista de faltantes no confirma ni promete', () => {
    const r = sinConfirmacionFalsa('Tu pedido quedó registrado.', fallo({ error: 'x' }), false);
    expect(r).not.toMatch(/registrado\./);
    expect(r).toContain('Todavía no');
  });
});

describe('sinPagoInventado', () => {
  it('no da por verificado un pago que nadie leyó', () => {
    const r = sinPagoInventado('¡Muchas gracias por la constancia, Diego! He verificado tu pago de S/ 77.00.', false);
    expect(r).toContain('Un asesor del equipo la revisa');
  });
  it('lo deja si hay voucher leído', () => {
    const t = 'Recibí tu Yape de S/ 77.00, operación 123.';
    expect(sinPagoInventado(t, true)).toBe(t);
  });
  it('no toca respuestas que no hablan del pago', () => {
    const t = 'Para tu mamá en Arequipa podemos enviarle 1 frasco.';
    expect(sinPagoInventado(t, false)).toBe(t);
  });
  it('detecta las formas habituales', () => {
    for (const t of ['Pago verificado ✅', 'Recibimos tu yape', 'Hemos confirmado tu adelanto', 'verifiqué el pago']) {
      expect(afirmaPagoVerificado(t)).toBe(true);
    }
    expect(afirmaPagoVerificado('Puedes yapear al 955 947 892 y nos envías la constancia')).toBe(false);
  });
});

describe('una visita agendada no es una confirmación falsa', () => {
  const visita = [{ nombre: 'agendar_visita_tienda', argumentos: {}, resultado: { registrada: true } }] as never;

  it('deja pasar "tu visita quedó agendada" si la visita se registró', () => {
    const r = '¡Listo, Percy! Tu visita quedó agendada para el martes 27 a las 8 am.';
    expect(sinConfirmacionFalsa(r, visita, false)).toBe(r);
  });

  it('pero no si dice que el pedido quedó registrado', () => {
    const r = 'Tu pedido quedó registrado y tu visita agendada.';
    expect(sinConfirmacionFalsa(r, visita, false)).not.toBe(r);
  });

  it('ni si la visita no se registró', () => {
    const r = 'Tu visita quedó agendada para el martes.';
    expect(sinConfirmacionFalsa(r, [], false)).not.toBe(r);
  });
});
