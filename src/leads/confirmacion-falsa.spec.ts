import { afirmaPedidoRegistrado, sinConfirmacionFalsa } from './confirmacion-falsa';
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
