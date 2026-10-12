import { ProductoController } from './producto.controller';
import { ListProductoDto } from './dto/list-producto.dto';
import { plainToInstance } from 'class-transformer';

/**
 * El filtro del kardex pide las variantes (tallas, colores) para poder elegir
 * una talla concreta. El servicio ya sabía hacerlo, pero el controller arma el
 * objeto campo por campo y `incluirVariantes` no estaba en la lista: la bandera
 * viajaba en la URL y se perdía en la última escala.
 *
 * El test del servicio pasaba en verde con la ruta muerta — lo destapó recién
 * la prueba en el navegador. Por eso este test mira el BORDE: la query tal como
 * llega por HTTP, transformada por el mismo ValidationPipe de producción.
 */
describe('GET /productos con incluirVariantes', () => {
  const montar = () => {
    const service = { listar: jest.fn().mockResolvedValue({ productos: [] }) };
    const controller = new ProductoController(
      service as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { controller, service };
  };

  // El controller escribe el mensaje de la respuesta en res.locals.
  const res = () => ({ locals: {} }) as any;

  const user = { id: 1, rol: 'ADMIN_EMPRESA', empresaId: 86, sedeId: 67 };

  // `plainToInstance` reproduce lo que hace el ValidationPipe con la query.
  const query = (raw: Record<string, string>) =>
    plainToInstance(ListProductoDto, raw, { enableImplicitConversion: false });

  it('la bandera llega al servicio', async () => {
    const { controller, service } = montar();
    await controller.listar(
      user,
      query({ search: 'Victoria Azul', incluirVariantes: 'true' }),
      res(),
    );

    expect(service.listar).toHaveBeenCalledWith(
      expect.objectContaining({ incluirVariantes: true }),
    );
  });

  it('sin la bandera el catálogo sigue escondiendo las variantes', async () => {
    const { controller, service } = montar();
    await controller.listar(user, query({ search: 'Victoria Azul' }), res());

    expect(service.listar.mock.calls[0][0].incluirVariantes).toBeFalsy();
  });

  it('el DTO no descarta el campo (si no, el whitelist lo borra)', () => {
    // La causa exacta del bug: un campo que el DTO no declara nunca llega.
    expect(query({ incluirVariantes: 'true' }).incluirVariantes).toBe(true);
  });
});
