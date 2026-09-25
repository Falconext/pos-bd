/**
 * Un kit puede llevar el mismo producto más de una vez: un pack de 2 cajas de
 * toffees es exactamente eso. El formulario manda dos filas iguales y el
 * servicio las contaba contra la base con `in: [7, 7]`, que devuelve UN
 * producto. Como 1 ≠ 2, el comerciante recibía "Algunos productos no existen o
 * no están activos" por productos que sí existían y estaban activos.
 *
 * (Caso reportado por la chocolatería, 2026-09-25.)
 */
import { CombosService } from './combos.service';

const TOFFEES = { id: 7, precioUnitario: 22.5 };
const CHOCOLATES = { id: 9, precioUnitario: 15 };

const prismaFalso = () => {
  const creado: any = {};
  return {
    creado,
    prisma: {
      producto: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            [TOFFEES, CHOCOLATES].filter((p) => where.id.in.includes(p.id)),
          ),
        ),
      },
      combo: {
        create: jest.fn(({ data }: any) => {
          Object.assign(creado, data);
          return Promise.resolve({ id: 1, ...data });
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn(({ data }: any) => {
          Object.assign(creado, data);
          return Promise.resolve({ id: 1, ...data });
        }),
      },
      comboItem: { deleteMany: jest.fn().mockResolvedValue({}) },
    } as any,
  };
};

const dto = (items: any[], precioCombo = 31) =>
  ({ nombre: 'Pack toffees', precioCombo, items }) as any;

describe('Kit con el mismo producto repetido', () => {
  it('dos filas del mismo producto NO son un error: se guardan como una línea de cantidad 2', async () => {
    const { prisma, creado } = prismaFalso();
    await new CombosService(prisma).create(1, dto([
      { productoId: 7, cantidad: 1 },
      { productoId: 7, cantidad: 1 },
    ]));
    expect(creado.items.create).toEqual([{ productoId: 7, cantidad: 2 }]);
  });

  it('el precio regular suma las dos unidades (22.50 × 2 = 45)', async () => {
    const { prisma, creado } = prismaFalso();
    await new CombosService(prisma).create(1, dto([
      { productoId: 7, cantidad: 1 },
      { productoId: 7, cantidad: 1 },
    ]));
    expect(Number(creado.precioRegular)).toBe(45);
    // El descuento se calcula sobre ese regular, no sobre una sola unidad.
    expect(Number(creado.descuentoPorcentaje)).toBeCloseTo(31.11, 2);
  });

  it('mezcla de repetido y distinto: se juntan solo los iguales', async () => {
    const { prisma, creado } = prismaFalso();
    await new CombosService(prisma).create(1, dto([
      { productoId: 7, cantidad: 2 },
      { productoId: 9, cantidad: 1 },
      { productoId: 7, cantidad: 1 },
    ], 50));
    expect(creado.items.create).toEqual([
      { productoId: 7, cantidad: 3 },
      { productoId: 9, cantidad: 1 },
    ]);
    expect(Number(creado.precioRegular)).toBe(22.5 * 3 + 15);
  });

  it('un producto que de verdad no existe sigue siendo error', async () => {
    const { prisma } = prismaFalso();
    await expect(
      new CombosService(prisma).create(1, dto([
        { productoId: 7, cantidad: 1 },
        { productoId: 999, cantidad: 1 },
      ])),
    ).rejects.toThrow('Algunos productos no existen o no están activos');
  });

  it('el precio del kit sigue teniendo que ser menor al regular', async () => {
    const { prisma } = prismaFalso();
    await expect(
      new CombosService(prisma).create(1, dto([
        { productoId: 7, cantidad: 1 },
        { productoId: 7, cantidad: 1 },
      ], 45)),
    ).rejects.toThrow('El precio del combo debe ser menor al precio regular');
  });

  it('al editar el kit pasa lo mismo: no se rompe por repetidos', async () => {
    const { prisma, creado } = prismaFalso();
    await new CombosService(prisma).update(1, 1, dto([
      { productoId: 7, cantidad: 1 },
      { productoId: 7, cantidad: 1 },
    ]) as any);
    expect(creado.items.create).toEqual([{ productoId: 7, cantidad: 2 }]);
    expect(Number(creado.precioRegular)).toBe(45);
  });
});
