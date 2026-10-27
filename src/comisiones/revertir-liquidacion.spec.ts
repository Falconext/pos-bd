import { EstadoComision } from '@prisma/client';
import { ComisionesService } from './comisiones.service';

/**
 * "Deshacer liquidación" debe ser el espejo exacto de "Liquidar": mismo
 * vendedor, misma empresa y mismo período, solo que de PAGADO a PENDIENTE.
 */
describe('Deshacer liquidación de comisiones', () => {
  const crear = () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma = { comisionVendedor: { updateMany } } as any;
    const service = new ComisionesService(prisma);
    return { service, updateMany };
  };

  it('regresa a PENDIENTE solo lo PAGADO del vendedor en el mes', async () => {
    const { service, updateMany } = crear();
    const r = await service.revertirComisionesPagadas(90, 7, 10, 2026);
    expect(updateMany).toHaveBeenCalledWith({
      where: { empresaId: 90, vendedorId: 7, mes: 10, anio: 2026, estado: EstadoComision.PAGADO },
      data: { estado: EstadoComision.PENDIENTE },
    });
    expect(r.actualizadas).toBe(3);
  });

  it('usa el mismo filtro de período que Liquidar (también con rango de fechas)', async () => {
    const { service, updateMany } = crear();
    await service.marcarComisionesPagadas(90, 7, undefined, undefined, '2026-10-01', '2026-10-15');
    await service.revertirComisionesPagadas(90, 7, undefined, undefined, '2026-10-01', '2026-10-15');
    const [liquidar, revertir] = updateMany.mock.calls.map((c) => c[0]);
    const { estado: e1, ...filtroLiquidar } = liquidar.where;
    const { estado: e2, ...filtroRevertir } = revertir.where;
    expect(filtroRevertir).toEqual(filtroLiquidar);
    expect([e1, e2]).toEqual([EstadoComision.PENDIENTE, EstadoComision.PAGADO]);
    expect(revertir.data).toEqual({ estado: EstadoComision.PENDIENTE });
  });
});
