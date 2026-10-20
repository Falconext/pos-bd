import { consolidarVentas, type ProductoParaComprar } from './consolidar-ventas';

const prod = (id: number, extra: Partial<ProductoParaComprar> = {}): ProductoParaComprar => ({
  id, descripcion: `PRODUCTO ${id}`, codigo: `P${id}`, costo: 10, gravado: true, stock: 0, seCompra: true, ...extra,
});

describe('notas de venta → una orden de compra', () => {
  const productos = new Map([
    [1, prod(1, { stock: 3 })],
    [2, prod(2, { costo: 4.5 })],
    [3, prod(3, { descripcion: 'INSTALACIÓN', seCompra: false })],
  ]);

  it('suma el mismo producto de varias notas y recuerda de cuál viene cada parte', () => {
    const { lineas } = consolidarVentas(
      [
        { id: 10, documento: 'NV01-00000025', detalles: [{ productoId: 1, cantidad: 2 }] },
        { id: 11, documento: 'NV01-00000026', detalles: [{ productoId: 1, cantidad: 5 }, { productoId: 2, cantidad: 1 }] },
      ],
      productos,
      new Map(),
    );
    expect(lineas[0]).toMatchObject({ productoId: 1, cantidadVendida: 7, stock: 3, precioUnitario: 10 });
    expect(lineas[0].origenes).toEqual([
      { documento: 'NV01-00000025', cantidad: 2 },
      { documento: 'NV01-00000026', cantidad: 5 },
    ]);
    expect(lineas[1]).toMatchObject({ productoId: 2, cantidadVendida: 1, precioUnitario: 4.5 });
  });

  it('un paquete vendido se pide en unidades y un kit se abre en sus componentes', () => {
    const { lineas } = consolidarVentas(
      [{
        id: 1, documento: 'NV01-1', detalles: [
          { productoId: 2, cantidad: 2, unidadesPorPaquete: 6 },
          { productoId: 99, comboId: 7, cantidad: 3, descripcion: 'PACK REGALO' },
        ],
      }],
      productos,
      new Map([[7, [{ productoId: 1, cantidad: 2 }, { productoId: 2, cantidad: 1 }]]]),
    );
    const porId = Object.fromEntries(lineas.map((l) => [l.productoId, l.cantidadVendida]));
    expect(porId).toEqual({ 1: 6, 2: 15 }); // 2×6 sueltas + 3 kits × 1
  });

  it('los servicios no se compran y los ítems libres van al final con costo 0', () => {
    const { lineas, omitidas } = consolidarVentas(
      [{
        id: 1, documento: 'NV01-1', detalles: [
          { productoId: null, descripcion: 'globo metálico', cantidad: 2 },
          { productoId: 3, cantidad: 1 },
          { productoId: null, descripcion: 'Globo Metálico ', cantidad: 1 },
          { productoId: 2, cantidad: 1 },
        ],
      }],
      productos,
      new Map(),
    );
    expect(omitidas).toEqual(['INSTALACIÓN']);
    expect(lineas.map((l) => [l.descripcion, l.cantidadVendida, l.precioUnitario])).toEqual([
      ['PRODUCTO 2', 1, 4.5],
      ['GLOBO METÁLICO', 3, 0],
    ]);
  });

  it('un producto que ya no está en el catálogo no se pierde: entra como texto', () => {
    const { lineas } = consolidarVentas(
      [{ id: 1, documento: 'NV01-1', detalles: [{ productoId: 555, descripcion: 'Rosa roja', cantidad: 12 }] }],
      productos,
      new Map(),
    );
    expect(lineas).toEqual([expect.objectContaining({ productoId: null, descripcion: 'ROSA ROJA', cantidadVendida: 12 })]);
  });
});
