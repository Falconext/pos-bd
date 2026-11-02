import { BadRequestException } from '@nestjs/common';
import { EmpresaService } from './empresa.service';

/**
 * Precio por mayor mezclando productos: el dueño lo enciende y elige las
 * categorías desde Perfil (PUT empresa/mia, que llega como Partial<> y no pasa
 * por class-validator). El servicio es la única barrera.
 */
function armar(categoriasDeLaEmpresa: number[]) {
  const prisma: any = {
    empresa: {
      findUnique: jest.fn().mockResolvedValue({ id: 7, brand: 'krezka', producto: 'mype', planId: 1 }),
      update: jest.fn().mockResolvedValue({ id: 7 }),
    },
    categoria: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id.in.filter((id: number) => categoriasDeLaEmpresa.includes(id)).map((id: number) => ({ id })),
        ),
      ),
    },
  };
  const service = new EmpresaService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(service, 'obtenerPorId').mockResolvedValue({ id: 7 } as any);
  return { prisma, service };
}

const datosGuardados = (prisma: any) => prisma.empresa.update.mock.calls[0][0].data;

describe('configuración del precio por mayor mezclando', () => {
  it('guarda el interruptor', async () => {
    const { prisma, service } = armar([]);
    await service.actualizar({ id: 7, mayoristaMezclaActivo: true } as any);
    expect(datosGuardados(prisma)).toEqual({ mayoristaMezclaActivo: true });
  });

  it('guarda las categorías propias, sin repetidas', async () => {
    const { prisma, service } = armar([3, 4]);
    await service.actualizar({ id: 7, mayoristaMezclaCategoriaIds: [3, 4, 3] } as any);
    expect(datosGuardados(prisma)).toEqual({ mayoristaMezclaCategoriaIds: [3, 4] });
    expect(prisma.categoria.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [3, 4] }, empresaId: 7 } }),
    );
  });

  it('lista vacía = todos los productos, sin consultar categorías', async () => {
    const { prisma, service } = armar([]);
    await service.actualizar({ id: 7, mayoristaMezclaCategoriaIds: [] } as any);
    expect(datosGuardados(prisma)).toEqual({ mayoristaMezclaCategoriaIds: [] });
    expect(prisma.categoria.findMany).not.toHaveBeenCalled();
  });

  it('rechaza una categoría de otra empresa y no guarda nada', async () => {
    const { prisma, service } = armar([3]);
    await expect(
      service.actualizar({ id: 7, mayoristaMezclaCategoriaIds: [3, 99] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('rechaza algo que no es una lista (PUT empresa/mia no valida el cuerpo)', async () => {
    const { prisma, service } = armar([3]);
    await expect(
      service.actualizar({ id: 7, mayoristaMezclaCategoriaIds: '3' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });
});
