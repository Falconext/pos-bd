import { sincronizarVariantes } from './variantes.util';

/**
 * Bug real: al crear una variante nueva (matriz Color x Talla), el costo
 * (costoPromedio/costoFijo) nunca se heredaba del producto padre — Prisma
 * aplicaba el default 0, así que el Excel de inventario mostraba "Costo" y
 * "Valor Inventario" en S/0 para variantes que nunca tuvieron una compra
 * propia registrada. precioUnitario/stock sí se heredaban correctamente.
 */
describe('sincronizarVariantes — herencia de costo del padre', () => {
  const padre = {
    id: 1,
    empresaId: 10,
    codigo: 'VC15',
    descripcion: 'VERONA',
    unidadMedidaId: 1,
    tipoAfectacionIGV: '10',
    precioUnitario: 179,
    igvPorcentaje: 18,
    categoriaId: 5,
    marcaId: null,
    porcentajeVenta: 100,
    porcentajeProvision: 0,
    publicarEnTienda: true,
    costoPromedio: 90,
    costoFijo: 0,
    opcionesAtributos: [{ nombre: 'Talla', valores: ['38'] }],
  };

  const sedes = [{ id: 100, esPrincipal: true }];

  const makePrisma = (variantesExistentes: any[]) => ({
    producto: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.productoPadreId != null) {
          return Promise.resolve(variantesExistentes);
        }
        // Chequeo de unicidad de código: todos los productos de la empresa.
        return Promise.resolve(
          variantesExistentes.map((v) => ({ id: v.id, codigo: v.codigo })),
        );
      }),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 999, ...data }),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    productoStock: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  });

  it('variante nueva: hereda costoPromedio/costoFijo del padre, no queda en 0', async () => {
    const prisma = makePrisma([]);
    await sincronizarVariantes(prisma as any, padre, sedes, [], 100);

    expect(prisma.producto.create).toHaveBeenCalledTimes(1);
    const createCall = prisma.producto.create.mock.calls[0][0];
    expect(Number(createCall.data.costoPromedio)).toBe(90);
    expect(Number(createCall.data.costoFijo)).toBe(0);
  });

  it('variante existente con costo propio (de una compra real): no se pisa con el del padre', async () => {
    const varianteExistente = {
      id: 55,
      codigo: 'VC15-38',
      valoresAtributos: { Talla: '38' },
      precioUnitario: 179,
      stock: 3,
      costoPromedio: 105.5, // costo real distinto al del padre, calculado por una compra
      costoFijo: 2,
    };
    const prisma = makePrisma([varianteExistente]);
    await sincronizarVariantes(prisma as any, padre, sedes, [], 100);

    expect(prisma.producto.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 55 },
        data: expect.anything(),
      }),
    );
    const updateCall = prisma.producto.update.mock.calls[0][0];
    expect(Number(updateCall.data.costoPromedio)).toBe(105.5);
    expect(Number(updateCall.data.costoFijo)).toBe(2);
  });
});
