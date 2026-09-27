/**
 * Cuántas fotos admite un producto.
 *
 * El formulario llegó a permitir 5 y en agosto se retiró entero por recargado;
 * vuelve acotado a 1 principal + 2 adicionales. Lo que se cuida aquí es que el
 * tope sea el mismo para todos los rubros (antes apicultura tenía uno propio) y
 * que el cálculo de "adicionales" no se desfase del total.
 */
import {
  getMaxImagenesProducto,
  getMaxImagenesExtra,
} from './rubro-features';

describe('Tope de imágenes por producto', () => {
  it('son 3 en total: la principal y dos más', () => {
    expect(getMaxImagenesProducto('ferretería')).toBe(3);
    expect(getMaxImagenesExtra('ferretería')).toBe(2);
  });

  it.each([
    'Ferretería',
    'Apicultura',
    'Venta de miel',
    'Farmacia',
    'Ropa y calzado',
    '',
  ])('el mismo tope para el rubro %j', (rubro) => {
    expect(getMaxImagenesProducto(rubro)).toBe(3);
    expect(getMaxImagenesExtra(rubro)).toBe(2);
  });

  it('sin rubro definido tampoco cambia', () => {
    expect(getMaxImagenesProducto(null)).toBe(3);
    expect(getMaxImagenesProducto(undefined)).toBe(3);
    expect(getMaxImagenesExtra(null)).toBe(2);
  });

  it('las adicionales son siempre el total menos la principal', () => {
    expect(getMaxImagenesExtra('cualquiera')).toBe(
      getMaxImagenesProducto('cualquiera') - 1,
    );
  });
});
