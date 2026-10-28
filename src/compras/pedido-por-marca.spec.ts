import { cantidadSugerida, etiquetaVariante } from './pedido-por-marca';
import { OrdenCompraService } from './orden-compra.service';

describe('Pedido por marca', () => {
  describe('cantidadSugerida', () => {
    it('repone lo vendido en el periodo', () => expect(cantidadSugerida(2, 0, 10)).toBe(8));
    it('nunca deja por debajo del mínimo', () => expect(cantidadSugerida(1, 6, 2)).toBe(5));
    it('con stock suficiente no sugiere', () => expect(cantidadSugerida(12, 6, 10)).toBe(0));
    it('sin ventas ni mínimo no sugiere', () => expect(cantidadSugerida(0, 0, 0)).toBe(0));
    it('stock negativo cuenta como cero', () => expect(cantidadSugerida(-3, 0, 4)).toBe(4));
    it('redondea hacia arriba fracciones', () => expect(cantidadSugerida(0, 0, 2.5)).toBe(3));
  });

  it('etiquetaVariante arma "Tono: 170-N"', () => {
    expect(etiquetaVariante({ Tono: '170-N' })).toBe('Tono: 170-N');
    expect(etiquetaVariante({ Color: 'Rojo', Talla: 'M' })).toBe('Color: Rojo · Talla: M');
    expect(etiquetaVariante(null)).toBeNull();
  });

  describe('sugeridoPorMarca', () => {
    const crear = () => {
      const prisma: any = {
        marca: { findFirst: jest.fn().mockResolvedValue({ id: 3, nombre: 'ÉSIKA' }) },
        producto: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 10, descripcion: 'Base Colorfix', stock: 0, stockMinimo: 0, costoPromedio: 50, tipoAfectacionIGV: '10', valoresAtributos: null,
              variantes: [
                { id: 11, descripcion: 'Base Colorfix - 170-N', stock: 1, stockMinimo: 2, costoPromedio: 50, tipoAfectacionIGV: '10', valoresAtributos: { Tono: '170-N' } },
                { id: 12, descripcion: 'Base Colorfix - 210-F', stock: 9, stockMinimo: 2, costoPromedio: 50, tipoAfectacionIGV: '10', valoresAtributos: { Tono: '210-F' } },
              ],
            },
            { id: 20, descripcion: 'Perfume Vibranza', stock: 3, stockMinimo: 0, costoPromedio: 70, tipoAfectacionIGV: '10', valoresAtributos: null, variantes: [] },
          ]),
        },
        productoStock: { findMany: jest.fn().mockResolvedValue([{ productoId: 20, stock: 1, stockMinimo: 0 }]) },
        movimientoKardex: { groupBy: jest.fn().mockResolvedValue([{ productoId: 11, _sum: { cantidad: 6 } }, { productoId: 20, _sum: { cantidad: 4 } }]) },
        ordenCompra: { findFirst: jest.fn().mockResolvedValue({ proveedor: { id: 7, nombre: 'BELCORP', nroDoc: '20100' } }) },
      };
      const service = Object.create(OrdenCompraService.prototype);
      service.prisma = prisma;
      return { service, prisma };
    };

    it('pide por tono, usa el stock de la sede y propone el último proveedor', async () => {
      const { service, prisma } = crear();
      const r = await service.sugeridoPorMarca(45, 3, 30, 66);
      expect(r.items.map((i: any) => [i.productoId, i.variante, i.stock, i.vendidos, i.sugerido])).toEqual([
        [11, 'Tono: 170-N', 1, 6, 5],
        [12, 'Tono: 210-F', 9, 0, 0],
        [20, null, 1, 4, 3],
      ]);
      expect(r.items[0].descripcion).toBe('Base Colorfix');
      expect(r.proveedorSugerido).toEqual({ id: 7, nombre: 'BELCORP', nroDoc: '20100' });
      const where = prisma.movimientoKardex.groupBy.mock.calls[0][0].where;
      expect(where).toMatchObject({ empresaId: 45, tipoMovimiento: 'SALIDA', sedeId: 66, comprobante: { estadoEnvioSunat: { not: 'ANULADO' } } });
      expect(prisma.producto.findMany.mock.calls[0][0].where).toMatchObject({ empresaId: 45, marcaId: 3, productoPadreId: null });
    });

    it('rechaza una marca de otra empresa', async () => {
      const { service, prisma } = crear();
      prisma.marca.findFirst.mockResolvedValue(null);
      await expect(service.sugeridoPorMarca(45, 3)).rejects.toThrow('Marca no encontrada');
    });
  });
});
