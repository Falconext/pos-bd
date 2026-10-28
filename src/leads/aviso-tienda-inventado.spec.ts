import { afirmaAvisoATienda, sinAvisoInventado } from './confirmacion-falsa';

// QA 27-10: cotizó un recojo y dijo "Ya dejé avisada la tienda" sin avisar.
const RESPUESTA =
  '¡Hola, Mario!\n\n*TOTAL: S/ 62.00*\n\nYa dejé avisada la tienda para tener listo tu pedido mañana a las 11:00 a.m. \n\nTe esperamos en *Av. Emancipación 687*. ¡Nos vemos!';

describe('"dejé avisada la tienda" sin avisar', () => {
  it.each([
    ['Ya dejé avisada la tienda para mañana.', true],
    ['La tienda quedó avisada.', true],
    ['Le avisé a la tienda que pasas.', true],
    ['¿Quieres que avise a la tienda?', false],
    ['Te aviso apenas llegue tu pedido.', false],
  ])('"%s" → %s', (t, esperado) => {
    expect(afirmaAvisoATienda(t)).toBe(esperado);
  });

  it('saca la frase falsa, deja la cotización y pide confirmar', () => {
    const r = sinAvisoInventado(RESPUESTA, [], false);
    expect(r).not.toMatch(/avisada/);
    expect(r).toContain('TOTAL: S/ 62.00');
    expect(r).toContain('Te esperamos');
    expect(r).toMatch(/Confírmame y aviso a la tienda\.$/);
  });

  it('si se avisó en este turno o antes, no toca nada', () => {
    const llamada = { nombre: 'avisar_visita_tienda', argumentos: {}, resultado: { avisado: true } };
    expect(sinAvisoInventado(RESPUESTA, [llamada as never], false)).toBe(RESPUESTA);
    expect(sinAvisoInventado(RESPUESTA, [], true)).toBe(RESPUESTA);
  });
});
