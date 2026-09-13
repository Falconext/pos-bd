import { DashboardService } from './dashboard.service';

/**
 * KPI "Utilidad" del dashboard: venta neta (sin IGV, en PEN) − costo promedio
 * del producto × unidades vendidas. Se instancia sin DI porque el método
 * solo usa prisma.
 */
describe('DashboardService.utilidadBrutaPen', () => {
  const crear = (detalles: any[]) => {
    const s = Object.create(DashboardService.prototype) as any;
    s.prisma = {
      detalleComprobante: { findMany: jest.fn().mockResolvedValue(detalles) },
    };
    return s;
  };

  it('resta el costo promedio por unidad a la venta neta', async () => {
    const s = crear([
      // 2 unidades a S/ 100 neto, costo 60 c/u => utilidad 80
      {
        cantidad: 2,
        mtoValorVenta: 200,
        producto: { costoPromedio: 60 },
        comprobante: { tipoMoneda: 'PEN', tipoCambio: 1 },
      },
      // ítem manual sin producto: costo 0 => utilidad 50
      {
        cantidad: 1,
        mtoValorVenta: 50,
        producto: null,
        comprobante: { tipoMoneda: 'PEN', tipoCambio: null },
      },
    ]);
    const r = await s.utilidadBrutaPen({ empresaId: 1 });
    expect(r).toEqual({ venta: 250, costo: 120, utilidad: 130 });
    expect(s.prisma.detalleComprobante.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { comprobante: { empresaId: 1 } } }),
    );
  });

  it('convierte ventas en USD a soles con el tipo de cambio del comprobante', async () => {
    const s = crear([
      {
        cantidad: 1,
        mtoValorVenta: 100,
        producto: { costoPromedio: 300 },
        comprobante: { tipoMoneda: 'USD', tipoCambio: 3.5 },
      },
    ]);
    const r = await s.utilidadBrutaPen({});
    expect(r).toEqual({ venta: 350, costo: 300, utilidad: 50 });
  });

  it('puede ser negativa cuando se vendió bajo costo', async () => {
    const s = crear([
      {
        cantidad: 3,
        mtoValorVenta: 90,
        producto: { costoPromedio: 40 },
        comprobante: { tipoMoneda: 'PEN', tipoCambio: 1 },
      },
    ]);
    const r = await s.utilidadBrutaPen({});
    expect(r.utilidad).toBe(-30);
  });

  it('sin ventas devuelve ceros', async () => {
    const r = await crear([]).utilidadBrutaPen({});
    expect(r).toEqual({ venta: 0, costo: 0, utilidad: 0 });
  });
});
