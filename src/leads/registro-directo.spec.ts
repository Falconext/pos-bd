import { conRegistroDirecto, yaAceptoAntes } from './registro-directo';

describe('registro directo', () => {
  it.each([
    ['si agendalo'],
    ['Sí, agéndamelo'],
    ['ok confirmo'],
    ['dale, lo quiero'],
  ])('reconoce la aceptación "%s"', (m) =>
    expect(yaAceptoAntes(['hola quiero inka muña', m])).toBe(true),
  );

  it.each([
    ['hola quiero inka muña'],
    ['cuánto cuesta el envío?'],
    ['¿se puede agendar para mañana?'],
  ])('no inventa una aceptación en "%s"', (m) =>
    expect(yaAceptoAntes([m])).toBe(false),
  );

  it('quita la pregunta de cierre y confirma con el número y el monto', () => {
    const r = conRegistroDirecto(
      'Te adjunto la Cotización 📋 *Pack*\n1x Inka muña - P.U. S/ 7.00\n*TOTAL: S/ 22.00*\nEsta sería la cotización completa considerando el envío. ¿Deseas que agendemos tu entrega?\n',
      'NV01-00000025',
      22,
    );
    expect(r).not.toMatch(/Deseas que agendemos/);
    expect(r).toContain('*TOTAL: S/ 22.00*');
    expect(r).toMatch(/registrado con el número NV01-00000025/);
    expect(r).toContain('S/ 22.00 al recibir');
  });

  it('si no termina en pregunta, no le quita nada', () => {
    const r = conRegistroDirecto('*TOTAL: S/ 22.00*', 'NV01-00000026');
    expect(r.startsWith('*TOTAL: S/ 22.00*')).toBe(true);
  });
});
