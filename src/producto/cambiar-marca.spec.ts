import { NotFoundException } from '@nestjs/common';
import { ProductoService } from './producto.service';

/**
 * Cambio rápido de marca desde la tabla de inventario: solo toca la marca y
 * nunca acepta un producto o una marca de otra empresa.
 */
describe('Cambiar marca desde la tabla', () => {
  const crear = (producto: any, marca: any) => {
    const update = jest.fn().mockResolvedValue({ id: 5, marcaId: marca?.id ?? null });
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue(producto), update },
      marca: { findFirst: jest.fn().mockResolvedValue(marca) },
    } as any;
    const service = Object.create(ProductoService.prototype);
    service.prisma = prisma;
    return { service, prisma, update };
  };

  it('asigna la marca de la misma empresa', async () => {
    const { service, prisma, update } = crear({ id: 5 }, { id: 9 });
    await service.cambiarMarca(5, 45, 9);
    expect(prisma.marca.findFirst).toHaveBeenCalledWith({ where: { id: 9, empresaId: 45 }, select: { id: true } });
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: 5 }, data: { marcaId: 9 } });
  });

  it('null deja el producto sin marca', async () => {
    const { service, prisma, update } = crear({ id: 5 }, null);
    await service.cambiarMarca(5, 45, null);
    expect(prisma.marca.findFirst).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).toEqual({ marcaId: null });
  });

  it('rechaza una marca de otra empresa', async () => {
    const { service, update } = crear({ id: 5 }, null);
    await expect(service.cambiarMarca(5, 45, 9)).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rechaza un producto de otra empresa', async () => {
    const { service, update } = crear(null, { id: 9 });
    await expect(service.cambiarMarca(5, 45, 9)).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});
