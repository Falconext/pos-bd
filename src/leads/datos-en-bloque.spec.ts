import { conBloqueDeDatosExacto } from './datos-en-bloque';

const BLOQUE = [
  'Para agendar tu pedido, compárteme estos datos en un solo mensaje:',
  '',
  '*DATOS PARA AGENDAR TU PEDIDO*',
  '- Nombres y apellidos:',
  '- DNI:',
  '- Agencia y sede donde recogerás:',
  '- Número de celular:',
].join('\n');

describe('los datos se piden con el bloque del negocio', () => {
  it('reemplaza el pedido de datos escrito por el modelo (validación del 20-10)', () => {
    const r = conBloqueDeDatosExacto(
      '¡Perfecto! Para terminar de armar tu cotización con el envío a Arequipa por Shalom, por favor confírmame tu *nombre completo*, *DNI* y tu *número de celular de contacto*.',
      BLOQUE,
    );
    expect(r).toBe(BLOQUE);
  });

  it('conserva la cotización y quita la lista suelta del modelo', () => {
    const r = conBloqueDeDatosExacto(
      [
        'Te adjunto la Cotización 📋 *Tu pedido*\n1x Uña de Gato - P.U. S/ 30.00\n*TOTAL: S/ 40.00*',
        'Para agendar, compárteme:',
        '- Nombre completo\n- DNI\n- Celular',
      ].join('\n\n'),
      BLOQUE,
    );
    expect(r).toContain('*TOTAL: S/ 40.00*');
    expect(r).not.toContain('- Nombre completo');
    expect(r.endsWith(BLOQUE)).toBe(true);
  });

  it('no toca un mensaje que confirma datos en vez de pedirlos', () => {
    const r = 'Listo, lo dejo a nombre de Diego Ortega con celular 991065217.';
    expect(conBloqueDeDatosExacto(r, BLOQUE)).toBe(r);
  });

  it('no toca nada si ya trae el bloque o si no hay bloque pendiente', () => {
    expect(conBloqueDeDatosExacto(BLOQUE, BLOQUE)).toBe(BLOQUE);
    const r = '¿Me das tu nombre y tu DNI?';
    expect(conBloqueDeDatosExacto(r, undefined)).toBe(r);
  });

  it('una pregunta por un solo dato no es un pedido de datos', () => {
    const r = '¿En qué distrito sería la entrega?';
    expect(conBloqueDeDatosExacto(r, BLOQUE)).toBe(r);
  });
});
