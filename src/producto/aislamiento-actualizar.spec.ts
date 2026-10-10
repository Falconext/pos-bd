/**
 * El cuerpo de la petición no puede decidir de QUÉ empresa es el producto.
 *
 * `PUT /productos/:id` armaba los datos así:
 *
 *   { id, empresaId: user.empresaId, sedeId, ...body }
 *
 * y el servicio busca el producto con `where: { id, empresaId }`. Como el
 * spread del cuerpo iba al final, un `empresaId` mandado por el cliente
 * pisaba el del token: un usuario autenticado de una empresa podía editar
 * productos de otra indicando su id. Verificado en local antes del fix: la
 * petición devolvía 200 y escribía.
 *
 * El orden es la corrección, y este test es lo que impide que se invierta de
 * nuevo en un refactor.
 */
import { ProductoController } from './producto.controller';

describe('PUT /productos/:id — de qué empresa son los datos', () => {
  const llamadas: Record<string, unknown>[] = [];
  const servicio = {
    actualizar: (data: Record<string, unknown>) => {
      llamadas.push(data);
      return Promise.resolve({ id: data.id });
    },
  } as never;

  // El controlador recibe varios servicios; solo se le da el que este test
  // usa, porque lo que se prueba es cómo arma los datos, no qué hace con ellos.
  const controlador = new (ProductoController as unknown as new (
    s: unknown,
  ) => ProductoController)(servicio);
  const res = { locals: {} } as never;
  const usuario = { empresaId: 23, sedeId: 5, id: 29 };

  beforeEach(() => {
    llamadas.length = 0;
  });

  const actualizar = (body: Record<string, unknown>) =>
    (controlador as unknown as {
      actualizar: (
        id: number,
        user: unknown,
        body: unknown,
        res: unknown,
      ) => Promise<unknown>;
    }).actualizar(100, usuario, body, res);

  it('la empresa sale del token, no del cuerpo', async () => {
    await actualizar({ empresaId: 999, precioUnitario: 1 });
    expect(llamadas[0].empresaId).toBe(23);
  });

  it('el id sale de la URL, no del cuerpo', async () => {
    await actualizar({ id: 777, precioUnitario: 1 });
    expect(llamadas[0].id).toBe(100);
  });

  it('la sede también sale del token', async () => {
    await actualizar({ sedeId: 999 });
    expect(llamadas[0].sedeId).toBe(5);
  });

  it('y lo demás del cuerpo sí pasa', async () => {
    // El fix no puede haber dejado de enviar los datos del producto.
    await actualizar({
      descripcion: 'MORINGA 100 CAPS',
      disponibilidad: 'BAJO_PEDIDO',
      prioridadVenta: 2,
    });
    expect(llamadas[0]).toMatchObject({
      descripcion: 'MORINGA 100 CAPS',
      disponibilidad: 'BAJO_PEDIDO',
      prioridadVenta: 2,
      id: 100,
      empresaId: 23,
    });
  });

  it('los tres juntos, que es el intento real', async () => {
    await actualizar({ id: 777, empresaId: 999, sedeId: 888, stock: 50 });
    expect(llamadas[0]).toMatchObject({
      id: 100,
      empresaId: 23,
      sedeId: 5,
      stock: 50,
    });
  });
});
