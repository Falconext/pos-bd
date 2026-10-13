import { KardexService } from './kardex.service';

/**
 * Filtrar el kardex por un producto que tiene tallas o colores.
 *
 * Caso real: el cliente buscó "los movimientos del producto Victoria azul talla
 * 35" y no obtuvo nada útil — "solo me aparece el producto en general". Las
 * tallas son productos HIJOS, así que la venta queda registrada contra la
 * variante y nunca contra el modelo: filtrar por el id del padre devolvía una
 * lista vacía mientras el stock del modelo sí se movía, que es exactamente la
 * contradicción que lo hizo escribir.
 */
describe('KardexService.obtenerKardexGeneral con variantes', () => {
  const montar = (variantes: { id: number }[]) => {
    const prisma = {
      producto: { findMany: jest.fn().mockResolvedValue(variantes) },
      movimientoKardex: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    return { service: new KardexService(prisma as any, {} as any, {} as any), prisma };
  };

  const whereUsado = (prisma: any) =>
    prisma.movimientoKardex.findMany.mock.calls[0][0].where;

  it('el modelo trae los movimientos de todas sus tallas', async () => {
    const { service, prisma } = montar([{ id: 10 }, { id: 11 }, { id: 12 }]);
    await service.obtenerKardexGeneral(56, { productoId: 7 } as any);

    // El padre se mantiene en la lista: puede tener movimientos propios de
    // antes de que se le crearan variantes.
    expect(whereUsado(prisma).productoId).toEqual({ in: [7, 10, 11, 12] });
  });

  it('una talla concreta trae solo la suya', async () => {
    // La variante no tiene hijos, así que el filtro queda en su id pelado.
    const { service, prisma } = montar([]);
    await service.obtenerKardexGeneral(56, { productoId: 11 } as any);

    expect(whereUsado(prisma).productoId).toBe(11);
  });

  it('las variantes se buscan dentro de la empresa', async () => {
    const { service, prisma } = montar([{ id: 10 }]);
    await service.obtenerKardexGeneral(56, { productoId: 7 } as any);

    expect(prisma.producto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productoPadreId: 7, empresaId: 56 } }),
    );
  });

  it('sin filtro de producto no se consulta el catálogo', async () => {
    const { service, prisma } = montar([]);
    await service.obtenerKardexGeneral(56, {} as any);

    expect(prisma.producto.findMany).not.toHaveBeenCalled();
    expect(whereUsado(prisma).productoId).toBeUndefined();
  });

  it('trae el nombre del modelo para poder rotular la talla', async () => {
    const { service, prisma } = montar([]);
    await service.obtenerKardexGeneral(56, { productoId: 11 } as any);

    const include = prisma.movimientoKardex.findMany.mock.calls[0][0].include;
    expect(include.producto.include.productoPadre).toEqual({
      select: { descripcion: true },
    });
  });
});
