import { ForbiddenException } from '@nestjs/common';
import { ProductoController } from './producto.controller';

/**
 * Que la restricción esté REALMENTE colgada de cada ruta que da de alta o de
 * baja un producto.
 *
 * Ya pasó una vez en este módulo: el servicio sabía hacer el trabajo y el
 * controller nunca le pasaba la bandera, así que los tests de la pieza estaban
 * en verde con la función muerta. Acá se entra por el controller, que es por
 * donde entra la cajera.
 */
describe('Rutas que agregan o quitan productos del inventario', () => {
  const montar = () => {
    const service = {
      crear: jest.fn().mockResolvedValue({ id: 1 }),
      eliminar: jest.fn().mockResolvedValue({ id: 1 }),
      cargaMasiva: jest.fn().mockResolvedValue({ total: 0 }),
      cargarMasivo: jest.fn().mockResolvedValue({ total: 0 }),
    };
    const controller = new ProductoController(
      service as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { controller, service };
  };

  const res = () => ({ locals: {} }) as any;
  const cajera = { rol: 'USUARIO_EMPRESA', empresaId: 86, sedeId: 67, bloquearCrearEliminarProductos: true };
  const libre = { ...cajera, bloquearCrearEliminarProductos: false };

  it('no puede dar de alta un producto', async () => {
    const { controller, service } = montar();
    await expect(controller.crear({} as any, cajera, res())).rejects.toThrow(ForbiddenException);
    // Lo que de verdad importa: ni siquiera se llamó al servicio.
    expect(service.crear).not.toHaveBeenCalled();
  });

  it('no puede borrar un producto', async () => {
    const { controller, service } = montar();
    await expect(controller.eliminarProducto(1, cajera, res())).rejects.toThrow(ForbiddenException);
    expect(service.eliminar).not.toHaveBeenCalled();
  });

  it('tampoco por la puerta de atrás: la carga masiva de Excel', async () => {
    // Importar un Excel da de alta decenas de productos de una sola vez; sin
    // esto, la restricción se saltaba con dos clics.
    const { controller } = montar();
    await expect(
      controller.cargarMasivo({ buffer: Buffer.from('x') } as any, cajera, {}, undefined),
    ).rejects.toThrow(ForbiddenException);
  });

  it('sin la restricción, las tres siguen funcionando', async () => {
    const { controller, service } = montar();
    await controller.crear({} as any, libre, res());
    await controller.eliminarProducto(1, libre, res());
    expect(service.crear).toHaveBeenCalled();
    expect(service.eliminar).toHaveBeenCalled();
  });
});
