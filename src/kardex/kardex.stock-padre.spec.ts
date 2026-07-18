import { KardexService } from './kardex.service';

/**
 * Verifica que, al mover el stock de una variante, el producto padre recalcula
 * su stock (global y por sede) como la suma de sus variantes.
 * Reproduce el bug: vender variantes NO actualizaba el `stock` del padre.
 */
describe('KardexService.sincronizarStockPadre', () => {
  const buildService = (mockPrisma: any) =>
    new KardexService(mockPrisma as any, {} as any);

  it('recalcula el stock del padre = suma de variantes tras una venta', async () => {
    // Padre id=1 con 2 variantes (S=id 10, M=id 11). Total inicial 20.
    // Tras vender 2 S y 2 M, cada variante queda en 8 → padre debe quedar 16.
    const mockPrisma = {
      producto: {
        // Llamada para obtener el productoPadreId de la variante movida
        findUnique: jest.fn().mockResolvedValue({ productoPadreId: 1 }),
        // Suma del stock global de las variantes activas
        aggregate: jest.fn().mockResolvedValue({ _sum: { stock: 16 } }),
        update: jest.fn().mockResolvedValue({}),
      },
      productoStock: {
        groupBy: jest.fn().mockResolvedValue([{ sedeId: 5, _sum: { stock: 16 } }]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const service = buildService(mockPrisma);
    // sincronizarStockPadre es privado; lo invocamos con un cast para el test.
    await (service as any).sincronizarStockPadre(10);

    // El padre (id 1) debe actualizarse a 16
    expect(mockPrisma.producto.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { stock: 16 },
    });
    // Y su stock por sede también
    expect(mockPrisma.productoStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productoId_sedeId: { productoId: 1, sedeId: 5 } },
        update: { stock: 16 },
      }),
    );
  });

  it('usa el cliente de transacción (tx) cuando se le pasa como argumento', async () => {
    const txClient = {
      producto: {
        findUnique: jest.fn().mockResolvedValue({ productoPadreId: 1 }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { stock: 16 } }),
        update: jest.fn().mockResolvedValue({}),
      },
      productoStock: {
        groupBy: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    // this.prisma NO debe usarse cuando se pasa un tx
    const rootPrisma = {
      producto: {
        findUnique: jest.fn(),
        aggregate: jest.fn(),
        update: jest.fn(),
      },
      productoStock: { groupBy: jest.fn(), upsert: jest.fn() },
    };

    const service = buildService(rootPrisma);
    await (service as any).sincronizarStockPadre(10, txClient);

    expect(txClient.producto.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { stock: 16 },
    });
    expect(rootPrisma.producto.findUnique).not.toHaveBeenCalled();
    expect(rootPrisma.producto.update).not.toHaveBeenCalled();
  });

  it('no hace nada si el producto no es una variante (sin padre)', async () => {
    const mockPrisma = {
      producto: {
        findUnique: jest.fn().mockResolvedValue({ productoPadreId: null }),
        aggregate: jest.fn(),
        update: jest.fn(),
      },
      productoStock: {
        groupBy: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const service = buildService(mockPrisma);
    await (service as any).sincronizarStockPadre(99);

    expect(mockPrisma.producto.aggregate).not.toHaveBeenCalled();
    expect(mockPrisma.producto.update).not.toHaveBeenCalled();
    expect(mockPrisma.productoStock.upsert).not.toHaveBeenCalled();
  });
});
