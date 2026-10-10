/**
 * Con qué afectación de IGV nace un producto.
 *
 * Pedido de FRUTA PURA (Ley de Amazonía, Ley 27037): sus ventas van exoneradas,
 * pero cada producto nuevo nacía gravado y había que corregirlo a mano. El
 * olvido no se nota al guardar: se nota en la factura, con el IGV ya cobrado.
 *
 * Lo que más importa acá NO es que la empresa amazónica salga exonerada, sino
 * que **una empresa normal no cambie de comportamiento**.
 */
import {
  AFECTACIONES_VALIDAS,
  afectacionDeCelda,
  afectacionPorDefecto,
} from './afectacion-igv';

describe('Una empresa normal no cambia', () => {
  it('sin Ley de Amazonía, gravado como siempre', () => {
    expect(afectacionPorDefecto({ leyAmazonia: false })).toBe('10');
  });

  it('sin empresa cargada, gravado: es el default que no sorprende', () => {
    // Equivocarse hacia gravado lo reclama el cliente el mismo día; hacia
    // exonerado es un tributo no cobrado que aparece meses después.
    expect(afectacionPorDefecto(null)).toBe('10');
    expect(afectacionPorDefecto(undefined)).toBe('10');
    expect(afectacionPorDefecto({})).toBe('10');
  });

  it('el import de Excel sin columna AFECT también cae a gravado', () => {
    expect(afectacionDeCelda('', { leyAmazonia: false })).toBe('10');
    expect(afectacionDeCelda(null, null)).toBe('10');
  });
});

describe('Bajo la Ley de Amazonía', () => {
  it('el producto nuevo nace exonerado', () => {
    expect(afectacionPorDefecto({ leyAmazonia: true })).toBe('20');
  });

  it('el import de Excel sin AFECT también', () => {
    expect(afectacionDeCelda('', { leyAmazonia: true })).toBe('20');
    expect(afectacionDeCelda(undefined, { leyAmazonia: true })).toBe('20');
    expect(afectacionDeCelda('   ', { leyAmazonia: true })).toBe('20');
  });
});

describe('Lo que el Excel SÍ dice manda sobre el default', () => {
  it('una celda con afectación explícita se respeta, aunque sea gravado', () => {
    // Un negocio amazónico también vende cosas gravadas; el default no puede
    // pisar lo que el usuario escribió.
    expect(afectacionDeCelda('10', { leyAmazonia: true })).toBe('10');
    expect(afectacionDeCelda('30', { leyAmazonia: true })).toBe('30');
    expect(afectacionDeCelda('40', { leyAmazonia: true })).toBe('40');
  });

  it('acepta el código venido como número de Excel', () => {
    expect(afectacionDeCelda(20, { leyAmazonia: false })).toBe('20');
    expect(afectacionDeCelda(10.0, { leyAmazonia: true })).toBe('10');
  });

  it('espacios alrededor no rompen el código', () => {
    expect(afectacionDeCelda(' 20 ', { leyAmazonia: false })).toBe('20');
  });

  it('un código inválido cae al default, no revienta la carga', () => {
    expect(afectacionDeCelda('99', { leyAmazonia: true })).toBe('20');
    expect(afectacionDeCelda('exonerado', { leyAmazonia: true })).toBe('20');
    expect(afectacionDeCelda('99', { leyAmazonia: false })).toBe('10');
  });

  it('solo existen los cuatro códigos del catálogo de productos', () => {
    expect(AFECTACIONES_VALIDAS).toEqual(['10', '20', '30', '40']);
  });
});
