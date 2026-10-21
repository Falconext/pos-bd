import { componentesQueQuedan, normalizarKitQuitados } from './kit-quitados';

describe('kit-quitados', () => {
  const kit = [
    { productoId: 1, cantidad: 12 },
    { productoId: 2, cantidad: 1 },
    { productoId: 3, cantidad: 1 },
  ];

  it('sin quitados devuelve el kit completo', () => {
    expect(componentesQueQuedan(kit, undefined)).toEqual(kit);
    expect(componentesQueQuedan(kit, [])).toEqual(kit);
    expect(componentesQueQuedan(kit, null)).toEqual(kit);
  });

  it('saca los productos quitados', () => {
    expect(componentesQueQuedan(kit, [2]).map((c) => c.productoId)).toEqual([1, 3]);
    expect(componentesQueQuedan(kit, ['3', 1]).map((c) => c.productoId)).toEqual([2]);
  });

  it('ignora ids que no son del kit o no son válidos', () => {
    expect(componentesQueQuedan(kit, [99, 'x', -1, 1.5])).toEqual(kit);
  });

  it('normaliza: enteros positivos sin repetir', () => {
    expect(normalizarKitQuitados([2, '2', 3, 0, null, 'a'])).toEqual([2, 3]);
    expect(normalizarKitQuitados('2')).toEqual([]);
  });
});
