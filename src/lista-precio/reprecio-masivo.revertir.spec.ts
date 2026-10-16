import { BadRequestException } from '@nestjs/common';
import { ReprecioMasivoService } from './reprecio-masivo.service';

/**
 * Deshacer un reprecio.
 *
 * El caso que motivó estas pruebas: con dos reprecios encima de los mismos
 * productos, deshacer el VIEJO primero borraba también el efecto del nuevo y
 * dejaba el historial mostrándolo como vigente. El empresario veía "+5%
 * aplicado" mientras cobraba el precio de antes de todo.
 */
describe('ReprecioMasivoService.revertir', () => {
  const ITEM = { productoId: 7, presentacionCodigo: '', precioAnterior: 10, precioNuevo: 12 };

  function servicio(opts: {
    lote?: any;
    posteriores?: any[];
    updateCount?: number;
    deleteCount?: number;
  }) {
    const lote = opts.lote ?? {
      id: 1,
      listaPrecioId: 3,
      creadoEn: new Date('2026-10-16T10:00:00Z'),
      revertidoEn: null,
      detalle: [ITEM],
    };
    const prisma: any = {
      reprecioLote: {
        findFirst: jest.fn().mockResolvedValue(lote),
        findMany: jest.fn().mockResolvedValue(opts.posteriores ?? []),
        update: jest.fn().mockReturnValue({ __op: 'updateLote' }),
      },
      listaPrecioItem: {
        updateMany: jest.fn().mockReturnValue({ __op: 'update' }),
        deleteMany: jest.fn().mockReturnValue({ __op: 'delete' }),
      },
      // Devuelve un resultado por operación, en el mismo orden que se enviaron.
      $transaction: jest.fn().mockImplementation((ops: any[]) =>
        Promise.resolve(
          ops.map((o) =>
            o.__op === 'update'
              ? { count: opts.updateCount ?? 1 }
              : o.__op === 'delete'
                ? { count: opts.deleteCount ?? 1 }
                : {},
          ),
        ),
      ),
    };
    return { svc: new ReprecioMasivoService(prisma), prisma };
  }

  it('rechaza deshacer si un reprecio posterior pisó los mismos productos', async () => {
    const { svc, prisma } = servicio({
      posteriores: [
        { creadoEn: new Date('2026-10-16T11:00:00Z'), detalle: [{ productoId: 7 }] },
      ],
    });

    await expect(svc.revertir(70, 1)).rejects.toThrow(BadRequestException);
    // Y, sobre todo, no tocó ni un precio.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deja deshacer si el reprecio posterior fue sobre OTROS productos', async () => {
    // Dos categorías distintas de la misma lista no se estorban: bloquearlas
    // sería una traba sin motivo.
    const { svc } = servicio({
      posteriores: [
        { creadoEn: new Date('2026-10-16T11:00:00Z'), detalle: [{ productoId: 99 }] },
      ],
    });

    await expect(svc.revertir(70, 1)).resolves.toEqual({
      ok: true,
      restaurados: 1,
      eliminados: 0,
    });
  });

  it('informa lo que realmente se tocó, no lo que se pensaba tocar', async () => {
    // Si la fila ya no existe, updateMany afecta 0: decir "1 restaurado" sería
    // mentirle al empresario sobre el estado de sus precios.
    const { svc } = servicio({ updateCount: 0 });

    await expect(svc.revertir(70, 1)).resolves.toEqual({
      ok: true,
      restaurados: 0,
      eliminados: 0,
    });
  });

  it('un producto que no tenía precio propio se BORRA de la lista, no se clava', async () => {
    const { svc, prisma } = servicio({
      lote: {
        id: 1,
        listaPrecioId: 3,
        creadoEn: new Date('2026-10-16T10:00:00Z'),
        revertidoEn: null,
        detalle: [{ productoId: 7, presentacionCodigo: '', precioAnterior: null, precioNuevo: 12 }],
      },
      deleteCount: 1,
    });

    await expect(svc.revertir(70, 1)).resolves.toEqual({
      ok: true,
      restaurados: 0,
      eliminados: 1,
    });
    expect(prisma.listaPrecioItem.deleteMany).toHaveBeenCalled();
    expect(prisma.listaPrecioItem.updateMany).not.toHaveBeenCalled();
  });

  it('no se puede deshacer dos veces', async () => {
    const { svc } = servicio({
      lote: {
        id: 1,
        listaPrecioId: 3,
        creadoEn: new Date(),
        revertidoEn: new Date(),
        detalle: [ITEM],
      },
    });
    await expect(svc.revertir(70, 1)).rejects.toThrow('Ese reprecio ya se deshizo.');
  });
});
