import { conCotizacionExacta } from './cotizacion-exacta';

const TEXTO_DEL_CODIGO = [
  'Te adjunto la Cotización 📋 *Tu pedido*',
  '1x Ulceras gastritis - NATURAL MEDIX ( 100 capsulas ) - P.U. S/ 31.00',
  'Guía de consumo de REGALO 🎁',
  'Envío Callao: S/ 15.00',
  '*TOTAL: S/ 46.00*',
  'Esta sería la cotización completa considerando el envío y el descuento que corresponda. ¿Deseas que agendemos tu entrega?',
].join('\n');
const llamadas = [{ nombre: 'cotizar', argumentos: {}, resultado: { texto: TEXTO_DEL_CODIGO } }];

describe('la cotización sale tal cual la armó el código', () => {
  it('repone el cuadro que el modelo reescribió (prueba del 20-10) y conserva su cierre', () => {
    const delModelo = [
      'Te adjunto la Cotización 📋',
      '1x Ulceras gastritis - NATURAL MEDIX ( 100 capsulas ) - P.U. S/ 31.00',
      'Guía de consumo de REGALO 🎁',
      'Costo por envío: S/ 15.00',
      'TOTAL: S/ 46.00',
      '',
      'Esta sería la cotización completa considerando el envío. El pago es contraentrega. ¿Deseas que agendemos?',
    ].join('\n');
    const r = conCotizacionExacta(delModelo, llamadas);
    expect(r).toContain('Envío Callao: S/ 15.00\n*TOTAL: S/ 46.00*');
    expect(r).not.toContain('Costo por envío');
    expect(r).toContain('El pago es contraentrega. ¿Deseas que agendemos?');
    expect(r.match(/Te adjunto/g)).toHaveLength(1);
  });

  it('si ya la copió bien no toca nada', () => {
    expect(conCotizacionExacta(TEXTO_DEL_CODIGO, llamadas)).toBe(TEXTO_DEL_CODIGO);
  });

  it('sin una cotización exitosa en el turno no toca nada', () => {
    const r = 'Te adjunto la Cotización 📋\nTOTAL: S/ 99.00';
    expect(conCotizacionExacta(r, [{ nombre: 'cotizar', argumentos: {}, resultado: { error: 'x' } }])).toBe(r);
  });

  it('si la respuesta no trae cuadro no inventa uno', () => {
    const r = '¿Para qué distrito sería la entrega?';
    expect(conCotizacionExacta(r, llamadas)).toBe(r);
  });

  it('respeta lo que el modelo escribió antes y el bloque de datos después', () => {
    const delModelo = [
      'Perfecto, te paso el total.',
      'Te adjunto la Cotización 📋 Pack',
      '1x Ulceras gastritis - P.U. S/ 31.00',
      'Envío: S/ 15.00',
      '*TOTAL: S/ 46.00*',
      '',
      '*DATOS PARA AGENDAR TU PEDIDO*',
      '- Nombres y apellidos:',
    ].join('\n');
    const r = conCotizacionExacta(delModelo, llamadas);
    expect(r.startsWith('Perfecto, te paso el total.\nTe adjunto la Cotización 📋 *Tu pedido*')).toBe(true);
    expect(r).toContain('\n\n*DATOS PARA AGENDAR TU PEDIDO*\n- Nombres y apellidos:');
  });
});
