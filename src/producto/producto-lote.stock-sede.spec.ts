import { ProductoLoteService } from './producto-lote.service';

/**
 * QA 2026-10-19: "Nuevo lote" y "Desactivar lote" solo tocaban
 * `Producto.stock`. La sede quedaba sin el lote (el POS no lo podía vender) y
 * el siguiente movimiento del producto recalculaba el global como suma de las
 * sedes, así que el lote desaparecía también de la tienda web.
 */
describe('ProductoLoteService: lotes y stock por sede', () => {
  const crearMock = (stockSede: number, sumaSedes: number) => {
    const tx: any = {
      productoStock: {
        upsert: jest.fn().mockResolvedValue({ stock: stockSede }),
        update: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _sum: { stock: sumaSedes } }),
      },
      producto: { update: jest.fn().mockResolvedValue({}) },
      productoLote: {
        create: jest.fn().mockResolvedValue({ id: 9, lote: 'L1' }),
        update: jest.fn().mockResolvedValue({ id: 9 }),
      },
      movimientoKardex: { create: jest.fn().mockResolvedValue({ id: 77 }) },
      movimientoKardexLote: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 5, costoPromedio: 3 }) },
      productoLote: {
        findUnique: jest.fn(),
      },
      sede: { findFirst: jest.fn().mockResolvedValue({ id: 18 }) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    return { prisma, tx, service: new ProductoLoteService(prisma) };
  };

  it('crearLote suma el stock en la sede y deja el global como suma de sedes', async () => {
    const { prisma, tx, service } = crearMock(2, 12);
    prisma.productoLote.findUnique.mockResolvedValue(null);
    await service.crearLote({
      productoId: 5, empresaId: 23, lote: 'L1', fechaVencimiento: new Date(),
      stockInicial: 10, usuarioId: 1, sedeId: 26,
    });
    expect(tx.productoStock.update).toHaveBeenCalledWith({
      where: { productoId_sedeId: { productoId: 5, sedeId: 26 } },
      data: { stock: 12, visibleEnSede: true },
    });
    expect(tx.producto.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { stock: 12 } });
    expect(tx.movimientoKardex.create.mock.calls[0][0].data).toMatchObject({
      sedeId: 26, stockAnterior: 2, stockActual: 12, tipoMovimiento: 'INGRESO',
    });
  });

  it('crearLote sin sede usa la principal', async () => {
    const { prisma, tx, service } = crearMock(0, 10);
    prisma.productoLote.findUnique.mockResolvedValue(null);
    await service.crearLote({
      productoId: 5, empresaId: 23, lote: 'L1', fechaVencimiento: new Date(),
      stockInicial: 10, usuarioId: 1,
    });
    expect(tx.movimientoKardex.create.mock.calls[0][0].data.sedeId).toBe(18);
  });

  it('desactivarLote descuenta de la sede, sin dejarla negativa', async () => {
    const { prisma, tx, service } = crearMock(3, 3);
    prisma.productoLote.findUnique.mockResolvedValue({
      id: 9, lote: 'L1', productoId: 5, stockActual: 7, costoUnitario: 3,
      producto: { empresaId: 23, stock: 10 },
    });
    await service.desactivarLote(9, 23, 1, 18);
    expect(tx.productoStock.update).toHaveBeenCalledWith({
      where: { productoId_sedeId: { productoId: 5, sedeId: 18 } },
      data: { stock: 0 },
    });
    expect(tx.producto.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { stock: 3 } });
    expect(tx.movimientoKardex.create.mock.calls[0][0].data).toMatchObject({
      sedeId: 18, tipoMovimiento: 'SALIDA', stockAnterior: 3, stockActual: 0,
    });
  });
});
