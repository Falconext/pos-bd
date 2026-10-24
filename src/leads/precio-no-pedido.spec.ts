import { pidioPrecio, sinPrecioNoPedido } from './precio-no-pedido';

describe('sinPrecioNoPedido', () => {
  const adelantado =
    'Para eso tenemos el plan *Emprendedor*, con boletas ilimitadas y alertas de stock bajo.\n\n' +
    'El plan está en S/ 39.90 al mes, más S/ 50 una sola vez por la instalación: te damos de alta en SUNAT.\n\n' +
    '¿Te lo muestro en una demo para que lo revises con calma?';

  it('quita el párrafo con montos si el cliente nunca preguntó', () => {
    const r = sinPrecioNoPedido(adelantado, ['hola', 'tengo una bodega', 'solo quiero emitir boletas']);
    expect(r).not.toMatch(/S\//);
    expect(r).toContain('plan *Emprendedor*');
    expect(r).toContain('¿Te lo muestro en una demo');
  });

  it('quita solo la oración con el monto cuando el párrafo mezcla', () => {
    const r = sinPrecioNoPedido(
      'Con Krezka llevas tallas y colores. El plan Negocio está en S/ 69.90 al mes. ¿Te armo una demo?',
      ['vendo ropa'],
    );
    expect(r).toBe('Con Krezka llevas tallas y colores. ¿Te armo una demo?');
  });

  it.each([
    'cuánto cuesta?',
    'precio?',
    'y cuanto sale',
    'cuál me conviene?',
    'está caro',
    'qué planes tienen',
    'cómo es el pago',
    'ya vi la demo, quiero contratar el corporativo',
    'cómo lo compro',
  ])('deja el precio si el cliente preguntó: %s', (pregunta) => {
    expect(sinPrecioNoPedido(adelantado, ['hola', pregunta])).toBe(adelantado);
  });

  it('mira toda la conversación, no solo el último mensaje', () => {
    expect(sinPrecioNoPedido(adelantado, ['cuánto cuesta?', 'tengo una bodega'])).toBe(adelantado);
  });

  it('no toca respuestas sin montos', () => {
    const r = '¿Hoy cómo atiendes los mensajes?';
    expect(sinPrecioNoPedido(r, ['hola'])).toBe(r);
  });

  it('si quitar los montos la deja vacía, la manda como estaba', () => {
    const r = 'S/ 39.90 al mes.';
    expect(sinPrecioNoPedido(r, ['hola'])).toBe(r);
  });

  it('reconoce S/. y montos en negrita', () => {
    const r = sinPrecioNoPedido('Te sirve. Cuesta **S/. 99.90** al mes.', ['tengo una farmacia']);
    expect(r).toBe('Te sirve.');
  });

  it('pidioPrecio no confunde palabras que solo empiezan igual', () => {
    expect(pidioPrecio(['planeo abrir otra tienda', 'valoro la atención', 'pierdo tiempo pasando mis compras'])).toBe(false);
  });
});
