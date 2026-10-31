import { afectacionDeLinea } from './afectacion-igv';

describe('afectación de una línea de venta', () => {
  const amazonia = { leyAmazonia: true };
  const normal = { leyAmazonia: false };

  it('sin nada pedido, la del producto', () => {
    expect(afectacionDeLinea(undefined, '20', normal)).toBe('20');
    expect(afectacionDeLinea(null, '10', amazonia)).toBe('10');
  });

  it('lo pedido manda (gratuito, exportación, exonerado)', () => {
    expect(afectacionDeLinea('21', '20', amazonia)).toBe('21');
    expect(afectacionDeLinea('15', '10', normal)).toBe('15');
    expect(afectacionDeLinea('40', '10', normal)).toBe('40');
  });

  it('Ley de Amazonía: gravado pedido sobre un producto exonerado o inafecto → el del producto', () => {
    expect(afectacionDeLinea('10', '20', amazonia)).toBe('20');
    expect(afectacionDeLinea(10, '30', amazonia)).toBe('30');
  });

  it('Ley de Amazonía: un producto gravado de verdad sigue gravado', () => {
    expect(afectacionDeLinea('10', '10', amazonia)).toBe('10');
  });

  it('sin Ley de Amazonía no se toca lo pedido', () => {
    expect(afectacionDeLinea('10', '20', normal)).toBe('10');
    expect(afectacionDeLinea('10', '20', null)).toBe('10');
  });

  it('ítem libre: lo pedido, o el default de la empresa', () => {
    expect(afectacionDeLinea(undefined, null, amazonia, true)).toBe('20');
    expect(afectacionDeLinea(undefined, null, normal, true)).toBe('10');
    expect(afectacionDeLinea('10', null, amazonia, true)).toBe('10');
  });
});
