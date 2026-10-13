import { ForbiddenException } from '@nestjs/common';
import { verificarPuedeCrearOEliminarProductos } from './puede-gestionar-productos.util';

/**
 * "Para que la cajera no tenga opción de quitar o agregar producto en el
 * inventario" — pedido de un minimarket.
 *
 * Es una RESTRICCIÓN con default false: el usuario que ya existe no cambia de
 * comportamiento cuando se despliega la columna, así que no hace falta
 * backfill. Alcanza al alta y a la baja del catálogo; vender y editar lo que ya
 * existe siguen igual.
 */
describe('Restringir alta y baja de productos', () => {
  const cajera = (bloqueada: boolean) => ({
    rol: 'USUARIO_EMPRESA',
    bloquearCrearEliminarProductos: bloqueada,
  });

  it('con la restricción activa, no puede', () => {
    expect(() => verificarPuedeCrearOEliminarProductos(cajera(true))).toThrow(
      ForbiddenException,
    );
  });

  it('el mensaje dice a quién pedírselo', () => {
    // Si no, la cajera llama por teléfono sin saber qué hay que destrabar.
    expect(() => verificarPuedeCrearOEliminarProductos(cajera(true))).toThrow(
      /administrador/i,
    );
  });

  it('sin la restricción trabaja como siempre', () => {
    expect(() =>
      verificarPuedeCrearOEliminarProductos(cajera(false)),
    ).not.toThrow();
  });

  it('un usuario de antes de la feature no queda bloqueado', () => {
    // El campo llega undefined mientras la columna no exista en su fila.
    expect(() =>
      verificarPuedeCrearOEliminarProductos({ rol: 'USUARIO_EMPRESA' }),
    ).not.toThrow();
  });

  it('el administrador nunca se queda afuera de su propio catálogo', () => {
    // Aunque la bandera estuviera encendida por error en su fila.
    expect(() =>
      verificarPuedeCrearOEliminarProductos({
        rol: 'ADMIN_EMPRESA',
        bloquearCrearEliminarProductos: true,
      }),
    ).not.toThrow();
  });
});
