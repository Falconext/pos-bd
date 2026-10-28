/**
 * Hierba Sana, 28-10: el cliente dijo "el viernes voy" y el asistente le
 * contestó "Ya quedó avisada la tienda para tener listas tus cápsulas". No
 * había pedido: nadie separó nada y el cliente iba a llegar confiado. Sin nota
 * de venta, decir que los productos están listos o separados es falso.
 */
import { sinProductosListosInventado } from './confirmacion-falsa';

const REAL =
  '¡Perfecto! Ya quedó avisada la tienda para tener listas tus cápsulas para este viernes 30 de octubre. 🛍️ Te esperamos en nuestra única sede.';

describe('productos "listos" sin pedido', () => {
  it('saca la frase del caso real y dice qué falta para separarlos', () => {
    const r = sinProductosListosInventado(REAL, false);
    expect(r).not.toMatch(/tener listas/);
    expect(r).toMatch(/Te esperamos en nuestra única sede/);
    expect(r).toMatch(/todavía no tengo tus productos separados/);
    expect(r).toMatch(/nombre completo/);
  });

  it.each([
    'La tienda ya quedó avisada para tener preparados tus productos este viernes a las 2 p. m.',
    'Te dejo separados los 2 frascos.',
    'Tus productos quedan reservados hasta el sábado.',
    'Ya están apartados para ti.',
  ])('también: "%s"', (frase) => {
    expect(sinProductosListosInventado(frase, false)).toMatch(/todavía no tengo tus productos separados/);
  });

  it('no corta la frase en "p. m." (QA 28-10 dejaba "m., ¿podrías…")', () => {
    const r = sinProductosListosInventado(
      'Tendremos todo listo para el viernes a las 2 p. m. ¿Podrías darme tu nombre completo?',
      false,
    );
    expect(r.startsWith('¿Podrías darme tu nombre completo?')).toBe(true);
    expect(r).not.toMatch(/^m\./);
  });

  it('una pregunta que empieza a mitad de frase sigue siendo pregunta', () => {
    const t = '¡Perfecto! Para dejar tus productos listos, ¿me podrías regalar tu nombre completo, por favor?';
    expect(sinProductosListosInventado(t, false)).toBe(t);
  });

  it('ni en "Av." de la dirección', () => {
    const r = sinProductosListosInventado(
      'Te esperamos en la Av. Emancipación 687. Ya están separados tus frascos.',
      false,
    );
    expect(r).toMatch(/^Te esperamos en la Av\. Emancipación 687\./);
    expect(r).not.toMatch(/separados tus frascos/);
  });

  it('con la nota de venta registrada no se toca', () => {
    expect(sinProductosListosInventado(REAL, true)).toBe(REAL);
  });

  it.each([
    '¿Quieres que te los deje separados para que pases a recogerlos?',
    'Tu cotización está lista: total S/ 60.00.',
    'Te esperamos el viernes en la tienda 🌿',
    'Tenemos 5 unidades disponibles.',
  ])('no confunde: "%s"', (frase) => {
    expect(sinProductosListosInventado(frase, false)).toBe(frase);
  });
});
