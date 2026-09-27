import { DashboardService } from './dashboard.service';

/**
 * KPI "Utilidad" del dashboard: venta neta (sin IGV, en PEN) − costo promedio
 * del producto × unidades vendidas. Se instancia sin DI porque el método
 * solo usa prisma.
 */
describe('DashboardService.utilidadBrutaPen', () => {
  const crear = (detalles: any[], costosPorSede: any[] = []) => {
    const s = Object.create(DashboardService.prototype) as any;
    s.prisma = {
      detalleComprobante: { findMany: jest.fn().mockResolvedValue(detalles) },
      productoStock: { findMany: jest.fn().mockResolvedValue(costosPorSede) },
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

  it('paquete vendido como UNA línea: el costo usa las unidades reales, no la cantidad facturada', async () => {
    const s = crear([
      // 1 caja de 10 (Empresa.paquetesComoUnaLinea) a S/49 neto: costo real
      // es 10 unidades × S/3.11, no 1 × S/3.11.
      {
        cantidad: 1,
        unidadesPorPaquete: 10,
        mtoValorVenta: 49,
        producto: { costoPromedio: 3.11 },
        comprobante: { tipoMoneda: 'PEN', tipoCambio: 1 },
      },
    ]);
    const r = await s.utilidadBrutaPen({});
    expect(r).toEqual({ venta: 49, costo: 31.1, utilidad: 17.9 });
  });

  /**
   * El margen se calcula con lo que pagó LA SEDE que vendió. Antes se usaba el
   * costo global del producto, así que una compra cara en un local castigaba
   * el margen de todos los demás — justo lo que volvía irreal la rentabilidad
   * por sede.
   */
  describe('costo de la sede que vendió', () => {
    const venta = (productoId: number, sedeId: number, costoGlobal: number) => ({
      cantidad: 1,
      mtoValorVenta: 300,
      productoId,
      producto: { costoPromedio: costoGlobal },
      comprobante: { tipoMoneda: 'PEN', tipoCambio: 1, sedeId },
    });

    it('usa el costo de la sede, no el global del producto', async () => {
      const s = crear(
        [venta(7, 1, 150)],
        [{ productoId: 7, sedeId: 1, costoPromedio: 100 }],
      );
      const r = await s.utilidadBrutaPen({});
      // Con el costo global (150) la utilidad sería 150.
      expect(r).toEqual({ venta: 300, costo: 100, utilidad: 200 });
    });

    it('dos sedes venden lo mismo y cada una carga su propio costo', async () => {
      const s = crear(
        [venta(7, 1, 150), venta(7, 2, 150)],
        [
          { productoId: 7, sedeId: 1, costoPromedio: 100 },
          { productoId: 7, sedeId: 2, costoPromedio: 200 },
        ],
      );
      const r = await s.utilidadBrutaPen({});
      expect(r).toEqual({ venta: 600, costo: 300, utilidad: 300 });
    });

    it('una sede sin costo propio sigue usando el global', async () => {
      // Es lo que sostiene la convivencia: mientras la sede esté en NULL, el
      // número que ve el empresario no cambia.
      const s = crear([venta(7, 3, 150)], []);
      const r = await s.utilidadBrutaPen({});
      expect(r).toEqual({ venta: 300, costo: 150, utilidad: 150 });
    });

    it('un costo de sede en cero es un costo, no un "sin dato"', async () => {
      // Mercadería recibida como bonificación: la sede no pagó nada por ella.
      const s = crear(
        [venta(7, 1, 150)],
        [{ productoId: 7, sedeId: 1, costoPromedio: 0 }],
      );
      const r = await s.utilidadBrutaPen({});
      expect(r).toEqual({ venta: 300, costo: 0, utilidad: 300 });
    });

    it('pide los costos en una sola consulta, no una por línea', async () => {
      // Un P&L del mes son miles de líneas: consultar por cada una sería
      // cambiar un reporte lento por uno inusable.
      const s = crear(
        [venta(7, 1, 150), venta(8, 1, 150), venta(7, 2, 150)],
        [{ productoId: 7, sedeId: 1, costoPromedio: 100 }],
      );
      await s.utilidadBrutaPen({});
      expect(s.prisma.productoStock.findMany).toHaveBeenCalledTimes(1);
      expect(s.prisma.productoStock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productoId: { in: [7, 8] }, sedeId: { in: [1, 2] } },
        }),
      );
    });

    it('un ítem manual sin producto no dispara la consulta de costos', async () => {
      const s = crear([
        {
          cantidad: 1,
          mtoValorVenta: 50,
          producto: null,
          comprobante: { tipoMoneda: 'PEN', tipoCambio: 1 },
        },
      ]);
      const r = await s.utilidadBrutaPen({});
      expect(s.prisma.productoStock.findMany).not.toHaveBeenCalled();
      expect(r).toEqual({ venta: 50, costo: 0, utilidad: 50 });
    });
  });
});
