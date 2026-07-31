import { ForbiddenException } from '@nestjs/common';
import { ProductoService } from './producto.service';

/**
 * Pruebas unitarias del feature "múltiples códigos de barra por producto".
 * Prisma y demás dependencias están mockeadas: probamos la lógica pura de
 * normalización, validación de colisión y sincronización (reemplazo de set).
 */
describe('ProductoService — códigos de barra múltiples', () => {
  let service: ProductoService;
  let prisma: any;

  const makeTx = () =>
    jest.fn().mockImplementation((ops: any[]) => Promise.all(ops));

  beforeEach(() => {
    prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue(null) },
      productoCodigoBarras: {
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: makeTx(),
    };
    service = new ProductoService(prisma, {} as any, {} as any, {} as any);
  });

  describe('normalizarCodigosExtra', () => {
    const norm = (codigos: string[], principal?: string) =>
      (service as any).normalizarCodigosExtra(codigos, principal);

    it('trim + uppercase', () => {
      expect(norm([' ean-a ', 'ean-b'])).toEqual(['EAN-A', 'EAN-B']);
    });
    it('deduplica (incluyendo tras normalizar)', () => {
      expect(norm(['EAN-A', 'ean-a', ' EAN-A '])).toEqual(['EAN-A']);
    });
    it('descarta vacíos y espacios', () => {
      expect(norm(['', '   ', 'EAN-C'])).toEqual(['EAN-C']);
    });
    it('descarta el código principal (no se duplica como extra)', () => {
      expect(norm(['PRINCIPAL', 'EAN-D'], 'principal')).toEqual(['EAN-D']);
    });
    it('lista vacía → []', () => {
      expect(norm([])).toEqual([]);
    });
  });

  describe('validarColisionCodigosExtra', () => {
    it('pasa cuando no hay colisión', async () => {
      await expect(
        (service as any).validarColisionCodigosExtra(1, ['EAN-A']),
      ).resolves.toBeUndefined();
    });

    it('lanza si choca con el código PRINCIPAL de otro producto', async () => {
      prisma.producto.findFirst.mockResolvedValueOnce({ descripcion: 'Perfume X' });
      await expect(
        (service as any).validarColisionCodigosExtra(1, ['EAN-A']),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lanza si choca con un código ALTERNO de otro producto', async () => {
      prisma.productoCodigoBarras.findFirst.mockResolvedValueOnce({
        producto: { descripcion: 'Perfume Y' },
      });
      await expect(
        (service as any).validarColisionCodigosExtra(1, ['EAN-A']),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('excluye el propio producto al validar (excludeProductoId)', async () => {
      await (service as any).validarColisionCodigosExtra(1, ['EAN-A'], 42);
      expect(prisma.producto.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 42 } }),
        }),
      );
      expect(prisma.productoCodigoBarras.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ productoId: { not: 42 } }),
        }),
      );
    });
  });

  describe('sincronizarCodigosBarrasExtra', () => {
    it('NO toca nada si codigos es undefined (campo no enviado)', async () => {
      await (service as any).sincronizarCodigosBarrasExtra(10, 1, undefined, null);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.productoCodigoBarras.deleteMany).not.toHaveBeenCalled();
    });

    it('reemplaza el set: borra los previos y crea los normalizados', async () => {
      await (service as any).sincronizarCodigosBarrasExtra(
        10,
        1,
        [' ean-a ', 'EAN-A', 'ean-b'],
        null,
      );
      expect(prisma.productoCodigoBarras.deleteMany).toHaveBeenCalledWith({
        where: { productoId: 10 },
      });
      expect(prisma.productoCodigoBarras.createMany).toHaveBeenCalledWith({
        data: [
          { productoId: 10, empresaId: 1, codigo: 'EAN-A' },
          { productoId: 10, empresaId: 1, codigo: 'EAN-B' },
        ],
      });
    });

    it('lista vacía → borra previos y NO crea (solo deleteMany en la transacción)', async () => {
      await (service as any).sincronizarCodigosBarrasExtra(10, 1, [], null);
      expect(prisma.productoCodigoBarras.deleteMany).toHaveBeenCalled();
      expect(prisma.productoCodigoBarras.createMany).not.toHaveBeenCalled();
    });

    it('propaga la colisión (no borra ni crea) si un código ya existe', async () => {
      prisma.producto.findFirst.mockResolvedValueOnce({ descripcion: 'Otro' });
      await expect(
        (service as any).sincronizarCodigosBarrasExtra(10, 1, ['EAN-A'], null),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
