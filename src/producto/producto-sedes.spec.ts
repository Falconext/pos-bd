import { BadRequestException } from '@nestjs/common';
import { ProductoService } from './producto.service';

/**
 * Disponibilidad de productos por sede (catálogo compartido vs. por sede).
 * Prisma mockeado: se prueba la lógica de resolución y las reglas de negocio
 * (no quitar con stock, variantes heredan, asignación masiva con omitidos).
 */
describe('ProductoService — disponibilidad por sede', () => {
  let service: ProductoService;
  let prisma: any;
  let kardex: any;

  const sedes = [
    { id: 1, nombre: 'Ancón', esPrincipal: true, tipo: 'PUNTO_DE_VENTA' },
    { id: 2, nombre: 'Zapallal', esPrincipal: false, tipo: 'PUNTO_DE_VENTA' },
  ];

  beforeEach(() => {
    prisma = {
      empresa: {
        findUnique: jest.fn().mockResolvedValue({ catalogoPorSede: false }),
      },
      sede: {
        findMany: jest.fn().mockResolvedValue(sedes),
        findFirst: jest.fn(),
      },
      producto: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      productoStock: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    kardex = { registrarMovimiento: jest.fn().mockResolvedValue({}) };
    service = new ProductoService(prisma, kardex, {} as any, {} as any);
  });

  describe('resolverSedesDisponiblesIniciales', () => {
    const resolver = (
      extra: Partial<
        Parameters<ProductoService['resolverSedesDisponiblesIniciales']>[0]
      >,
    ) =>
      service.resolverSedesDisponiblesIniciales({
        sedes,
        sedeConStock: 1,
        stockInicial: 0,
        catalogoPorSede: false,
        ...extra,
      });

    it('catálogo compartido → todas las sedes (comportamiento histórico)', () => {
      expect([...resolver({})].sort()).toEqual([1, 2]);
    });
    it('catálogo por sede → solo la sede que crea', () => {
      expect([...resolver({ catalogoPorSede: true, sedeConStock: 2 })]).toEqual(
        [2],
      );
    });
    it('catálogo por sede sin sede conocida → todas (fallback seguro)', () => {
      expect(
        [...resolver({ catalogoPorSede: true, sedeConStock: null })].sort(),
      ).toEqual([1, 2]);
    });
    it('lista explícita del formulario manda sobre el modo', () => {
      expect([
        ...resolver({ sedesDisponibles: [2], catalogoPorSede: false }),
      ]).toEqual([2]);
    });
    it('la sede con stock inicial > 0 siempre queda incluida', () => {
      expect(
        [...resolver({ sedesDisponibles: [2], stockInicial: 5 })].sort(),
      ).toEqual([1, 2]);
    });
    it('ids que no son de la empresa se ignoran; lista vacía cae al modo', () => {
      expect([
        ...resolver({ sedesDisponibles: [99], catalogoPorSede: true }),
      ]).toEqual([1]);
    });
  });

  describe('inicializarStockPorSede (vía crear)', () => {
    it('por sede: la fila de la otra sede queda visibleEnSede=false', async () => {
      prisma.empresa.findUnique.mockResolvedValue({ catalogoPorSede: true });
      await (service as any).inicializarStockPorSede({
        productoId: 10,
        empresaId: 1,
        sedeId: 1,
        esServicio: false,
        stock: 7,
      });
      const rows = prisma.productoStock.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(rows.find((r: any) => r.sedeId === 1)).toMatchObject({
        stock: 7,
        visibleEnSede: true,
      });
      expect(rows.find((r: any) => r.sedeId === 2)).toMatchObject({
        stock: 0,
        visibleEnSede: false,
      });
    });
    it('compartido: ambas visibles, stock solo en la sede creadora', async () => {
      await (service as any).inicializarStockPorSede({
        productoId: 10,
        empresaId: 1,
        sedeId: 2,
        esServicio: false,
        stock: 3,
      });
      const rows = prisma.productoStock.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.visibleEnSede)).toEqual([true, true]);
      expect(rows.find((r: any) => r.sedeId === 2).stock).toBe(3);
      expect(rows.find((r: any) => r.sedeId === 1).stock).toBe(0);
    });
  });

  describe('aplicarSedesDisponibles', () => {
    it('no permite quitar de una sede con stock', async () => {
      prisma.productoStock.findMany.mockResolvedValue([
        { sedeId: 1, stock: 4 },
      ]);
      await expect(
        service.aplicarSedesDisponibles(10, 1, [2]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.productoStock.upsert).not.toHaveBeenCalled();
    });
    it('exige al menos una sede', async () => {
      await expect(
        service.aplicarSedesDisponibles(10, 1, []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('marca disponible/no disponible por sede y propaga a variantes', async () => {
      prisma.producto.findMany.mockResolvedValue([{ id: 11 }, { id: 12 }]);
      prisma.productoStock.findMany
        .mockResolvedValueOnce([
          { sedeId: 1, stock: 0 },
          { sedeId: 2, stock: 0 },
        ])
        .mockResolvedValueOnce([
          { sedeId: 1, visibleEnSede: true },
          { sedeId: 2, visibleEnSede: false },
        ]);
      await service.aplicarSedesDisponibles(10, 1, [1]);
      const upserts = prisma.productoStock.upsert.mock.calls.map(
        (c: any) => c[0],
      );
      expect(
        upserts.find((u: any) => u.where.productoId_sedeId.sedeId === 1).update,
      ).toEqual({ visibleEnSede: true });
      expect(
        upserts.find((u: any) => u.where.productoId_sedeId.sedeId === 2).update,
      ).toEqual({ visibleEnSede: false });
      // variantes heredan por sede
      expect(prisma.productoStock.updateMany).toHaveBeenCalledWith({
        where: { productoId: { in: [11, 12] }, sedeId: 2 },
        data: { visibleEnSede: false },
      });
    });
  });

  describe('asignarSedeMasivo', () => {
    it('omite los que tienen stock al quitar y aplica al resto', async () => {
      prisma.sede.findFirst.mockResolvedValue({ id: 2, nombre: 'Zapallal' });
      prisma.producto.findMany.mockResolvedValue([
        { id: 1, descripcion: 'Con stock', stocks: [{ stock: 3 }] },
        { id: 2, descripcion: 'Sin stock', stocks: [{ stock: 0 }] },
        { id: 3, descripcion: 'Sin fila', stocks: [] },
      ]);
      const r = await service.asignarSedeMasivo(1, 2, [1, 2, 3, 3], false);
      expect(r.actualizados).toBe(2);
      expect(r.omitidos).toEqual([
        { id: 1, descripcion: 'Con stock', stock: 3 },
      ]);
      expect(prisma.productoStock.upsert).toHaveBeenCalledTimes(2);
    });
    it('asignar nunca omite', async () => {
      prisma.sede.findFirst.mockResolvedValue({ id: 2, nombre: 'Zapallal' });
      prisma.producto.findMany.mockResolvedValue([
        { id: 1, descripcion: 'A', stocks: [{ stock: 3 }] },
      ]);
      const r = await service.asignarSedeMasivo(1, 2, [1], true);
      expect(r).toMatchObject({ actualizados: 1, omitidos: [] });
    });
    it('sede ajena → error', async () => {
      prisma.sede.findFirst.mockResolvedValue(null);
      await expect(
        service.asignarSedeMasivo(1, 9, [1], true),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('asignarProductoASede', () => {
    it('marca disponible y registra INGRESO en kardex si viene stock', async () => {
      prisma.producto.findFirst.mockResolvedValue({
        id: 5,
        costoPromedio: 2,
        atributosTecnicos: null,
      });
      prisma.sede.findFirst.mockResolvedValue({ id: 2, nombre: 'Zapallal' });
      jest.spyOn(service, 'obtenerPorId').mockResolvedValue({ id: 5 } as any);
      await service.asignarProductoASede(1, 5, 2, 12, 77);
      expect(prisma.productoStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { visibleEnSede: true } }),
      );
      expect(kardex.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({
          sedeId: 2,
          tipoMovimiento: 'INGRESO',
          cantidad: 12,
          usuarioId: 77,
        }),
      );
    });
    it('sin stock no toca kardex', async () => {
      prisma.producto.findFirst.mockResolvedValue({
        id: 5,
        costoPromedio: 2,
        atributosTecnicos: null,
      });
      prisma.sede.findFirst.mockResolvedValue({ id: 2, nombre: 'Zapallal' });
      jest.spyOn(service, 'obtenerPorId').mockResolvedValue({ id: 5 } as any);
      await service.asignarProductoASede(1, 5, 2, 0);
      expect(kardex.registrarMovimiento).not.toHaveBeenCalled();
    });
  });

  describe('verificarCodigo', () => {
    it('sin código → no existe', async () => {
      expect(await service.verificarCodigo(1, '', '')).toEqual({
        existe: false,
      });
    });
    it('existente → reporta disponibilidad en la sede consultada', async () => {
      prisma.producto.findFirst.mockResolvedValue({
        id: 5,
        codigo: 'C-100',
        codigoBarras: null,
        descripcion: 'Cargador',
        precioUnitario: 10,
        imagenUrl: null,
        estado: 'ACTIVO',
      });
      prisma.productoStock.findMany.mockResolvedValue([
        { sedeId: 1, stock: 4, visibleEnSede: true },
        { sedeId: 2, stock: 0, visibleEnSede: false },
      ]);
      const r: any = await service.verificarCodigo(1, 'C-100', undefined, 2);
      expect(r.existe).toBe(true);
      expect(r.producto.disponibleEnSede).toBe(false);
      expect(r.producto.sedes).toEqual([
        {
          sedeId: 1,
          nombre: 'Ancón',
          esPrincipal: true,
          tipo: 'PUNTO_DE_VENTA',
          disponible: true,
          stock: 4,
        },
        {
          sedeId: 2,
          nombre: 'Zapallal',
          esPrincipal: false,
          tipo: 'PUNTO_DE_VENTA',
          disponible: false,
          stock: 0,
        },
      ]);
    });
  });
});
