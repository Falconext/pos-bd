import { pideBrochure } from './brochure';

describe('cuándo se manda el brochure', () => {
  it.each([
    'Hola, quiero más información',
    'Hola! Quiero más info',
    '¡Hola! Quiero más información sobre esto.',
  ])('no con el mensaje del anuncio: %s', (texto) => {
    expect(pideBrochure(texto, true)).toBe(false);
  });

  it.each([
    'me pasas el brochure?',
    'tienes algún folleto',
    'mándame el catálogo',
    'tienes un PDF para mi socio?',
    'hay alguna presentación?',
  ])('sí cuando lo pide por su nombre, aunque sea su primer mensaje: %s', (texto) => {
    expect(pideBrochure(texto, true)).toBe(true);
    expect(pideBrochure(texto, false)).toBe(true);
  });

  it('"más información" ya conversando sí lo manda', () => {
    expect(pideBrochure('ok, mándame más información', false)).toBe(true);
  });

  it.each([
    'envíame la cuenta para pagar',
    'cuéntame más del plan corporativo',
    'quiero más detalles del precio',
    'VENTA DE CALZADOS\nVendo por tienda física y por internet',
  ])('no por frases que no piden material: %s', (texto) => {
    expect(pideBrochure(texto, false)).toBe(false);
  });
});
