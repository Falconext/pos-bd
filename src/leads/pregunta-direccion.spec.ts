import { intencionDireccion, pistaDireccion } from './pregunta-direccion';

describe('"Dirección" es una pregunta (Hierba Sana, 21 y 23-10)', () => {
  it.each([
    'Dirección',
    'Dirección????',
    'Dirección x favor',
    'Dirección y',
    'Su direccion  o como se realiza la compra',
    '¡Hola! Quiero más informacióndireccion de tienda fisica',
    'Estoy en Los Olivos , que dirección de la tienda',
    'me da la direccion para comprarlo lo usare para poder dormir',
    'dónde están ubicados?',
    'cómo llego?',
    'ubicación',
  ])('"%s" → pregunta', (msg) => {
    expect(intencionDireccion(msg)).toBe('pregunta');
  });

  it.each(['Gracias por dar tu dirección', 'Gracias por la Dirección  Soy de Provincia', 'muchas gracias por la ubicación'])(
    '"%s" → agradece',
    (msg) => {
      expect(intencionDireccion(msg)).toBe('agradece');
    },
  );

  it.each([
    'Mi dirección es Av. Perú 123, San Martín de Porres',
    'Jr. Lima 456 Los Olivos',
    'Dirección: Calle Las Flores 230 Surco',
    'Quiero el glucora',
    '',
  ])('"%s" → nada (da su dirección o no habla de eso)', (msg) => {
    expect(intencionDireccion(msg)).toBeNull();
  });

  it('si acabamos de pedirle sus datos, no se fuerza nada', () => {
    const pedimos = '*DATOS PARA AGENDAR TU PEDIDO*\n- Dirección (calle y número):';
    expect(intencionDireccion('dirección?', pedimos)).toBeNull();
    expect(intencionDireccion('Dirección', 'indícanos la dirección exacta y una referencia')).toBeNull();
  });

  it('un mensaje largo lo resuelve el modelo', () => {
    expect(
      intencionDireccion('hola buenas tardes quería saber si tienen el producto para la próstata y también cuál es la dirección de su tienda para ir mañana temprano con mi esposa'),
    ).toBeNull();
  });

  it('la pista dice qué hacer', () => {
    expect(pistaDireccion('Dirección')).toMatch(/PREGUNTA POR LA DIRECCIÓN DEL NEGOCIO/);
    expect(pistaDireccion('Dirección')).toMatch(/no le pidas sus datos de envío/);
    expect(pistaDireccion('Gracias por dar tu dirección')).toMatch(/recojo/);
    expect(pistaDireccion('Quiero el glucora')).toBe('');
  });
});
