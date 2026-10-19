import { conNombreBienEscrito } from './nombre-negocio';

describe('el nombre del negocio, bien escrito', () => {
  it.each([
    ['Soy Claudio, de Hígerba Sana.', 'Soy Claudio, de Hierba Sana.'],
    ['Soy Claudio, de Híerba Sana.', 'Soy Claudio, de Hierba Sana.'],
    ['Soy Claudio de Híerva Sana.', 'Soy Claudio de Hierba Sana.'],
  ])('corrige "%s"', (mal, bien) => {
    expect(conNombreBienEscrito(mal, 'HIERBA SANA')).toBe(bien);
  });

  it('respeta el nombre ya bien escrito, en cualquier caja', () => {
    const t = 'Soy Claudio, de HIERBA SANA. Bienvenido a Hierba Sana.';
    expect(conNombreBienEscrito(t, 'HIERBA SANA')).toBe(t);
  });

  it('no toca palabras que no se parecen', () => {
    const t = 'La hierba luisa ayuda a la digestión, es sana y natural.';
    expect(conNombreBienEscrito(t, 'HIERBA SANA')).toBe(t);
  });
});
