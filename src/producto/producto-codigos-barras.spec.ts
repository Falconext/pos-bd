import { ForbiddenException } from '@nestjs/common';
import { ProductoService } from './producto.service';

/**
 * Pruebas unitarias del feature "múltiples códigos de barra por producto"
 * (mismo perfume con distinto EAN según lote/importación). Prisma y demás
 * dependencias están mockeadas: se prueba la lógica pura de normalización,
 * validación de colisión y sincronización (reemplazo del set).
 *
 * Cada código alterno es un objeto, no un string: además del EAN lleva la
 * presentación (unidades por paquete, precio del paquete, alias, código
 * interno e imagen).
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

  /** Un código suelto, con la presentación por defecto. */
  const suelto = (codigo: string, extra: Record<string, any> = {}) => ({
    codigo,
    unidadesPorPaquete: 1,
    precioPaquete: null,
    alias: null,
    codigoInterno: null,
    imagenUrl: null,
    ...extra,
  });

  describe('normalizarCodigosExtra', () => {
    const norm = (codigos: any[], principal?: string) =>
      (service as any).normalizarCodigosExtra(codigos, principal);

    it('trim + uppercase', () => {
      expect(norm([' ean-a ', 'ean-b'])).toEqual([suelto('EAN-A'), suelto('EAN-B')]);
    });

    it('deduplica (incluyendo tras normalizar)', () => {
      expect(norm(['EAN-A', 'ean-a', ' EAN-A '])).toEqual([suelto('EAN-A')]);
    });

    it('descarta vacíos y espacios', () => {
      expect(norm(['', '   ', 'EAN-C'])).toEqual([suelto('EAN-C')]);
    });

    it('descarta el código principal (no se duplica como extra)', () => {
      expect(norm(['PRINCIPAL', 'EAN-D'], 'principal')).toEqual([suelto('EAN-D')]);
    });

    it('lista vacía → []', () => {
      expect(norm([])).toEqual([]);
    });

    it('conserva la presentación del paquete', () => {
      expect(
        norm([
          {
            codigo: ' ean-caja ',
            unidadesPorPaquete: 12,
            precioPaquete: 240,
            alias: ' Caja x12 ',
            codigoInterno: ' 22005-cj ',
          },
        ]),
      ).toEqual([
        suelto('EAN-CAJA', {
          unidadesPorPaquete: 12,
          precioPaquete: 240,
          alias: 'Caja x12',
          codigoInterno: '22005-CJ',
        }),
      ]);
    });

    it('unidades por paquete nunca baja de 1 ni queda fraccionada', () => {
      const r = norm([
        { codigo: 'A', unidadesPorPaquete: 0 },
        { codigo: 'B', unidadesPorPaquete: -5 },
        { codigo: 'C', unidadesPorPaquete: 2.7 },
      ]);
      expect(r.map((x: any) => x.unidadesPorPaquete)).toEqual([1, 1, 2]);
    });

    it('un precio de paquete en cero o negativo no se guarda', () => {
      const r = norm([
        { codigo: 'A', precioPaquete: 0 },
        { codigo: 'B', precioPaquete: -3 },
        { codigo: 'C', precioPaquete: 240 },
      ]);
      expect(r.map((x: any) => x.precioPaquete)).toEqual([null, null, 240]);
    });
  });

  describe('validarColisionCodigosExtra', () => {
    it('pasa cuando no hay colisión', async () => {
      await expect(
        (service as any).validarColisionCodigosExtra(1, [suelto('EAN-A')]),
      ).resolves.toBeUndefined();
    });

    it('busca el código que se le pasó, no uno vacío', async () => {
      await (service as any).validarColisionCodigosExtra(1, [suelto('EAN-A')]);
      expect(prisma.producto.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ codigoBarras: 'EAN-A' }),
        }),
      );
      expect(prisma.productoCodigoBarras.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ codigo: 'EAN-A' }),
        }),
      );
    });

    it('lanza si choca con el código PRINCIPAL de otro producto', async () => {
      prisma.producto.findFirst.mockResolvedValueOnce({ descripcion: 'Perfume X' });
      await expect(
        (service as any).validarColisionCodigosExtra(1, [suelto('EAN-A')]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lanza si choca con un código ALTERNO de otro producto', async () => {
      prisma.productoCodigoBarras.findFirst.mockResolvedValueOnce({
        producto: { descripcion: 'Perfume Y' },
      });
      await expect(
        (service as any).validarColisionCodigosExtra(1, [suelto('EAN-A')]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('el código interno tampoco puede ser el SKU de otro producto', async () => {
      prisma.producto.findFirst.mockResolvedValueOnce({ descripcion: 'Otro' });
      await expect(
        (service as any).validarColisionCodigosExtra(1, [
          suelto('EAN-A', { codigoInterno: '22005-CJ' }),
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('excluye el propio producto al validar (excludeProductoId)', async () => {
      await (service as any).validarColisionCodigosExtra(1, [suelto('EAN-A')], 42);
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
          { productoId: 10, empresaId: 1, ...suelto('EAN-A') },
          { productoId: 10, empresaId: 1, ...suelto('EAN-B') },
        ],
      });
    });

    it('guarda la presentación del paquete tal como se normalizó', async () => {
      await (service as any).sincronizarCodigosBarrasExtra(
        10,
        1,
        [{ codigo: 'ean-caja', unidadesPorPaquete: 12, precioPaquete: 240, alias: 'Caja x12' }],
        null,
      );
      expect(prisma.productoCodigoBarras.createMany).toHaveBeenCalledWith({
        data: [
          {
            productoId: 10,
            empresaId: 1,
            ...suelto('EAN-CAJA', {
              unidadesPorPaquete: 12,
              precioPaquete: 240,
              alias: 'Caja x12',
            }),
          },
        ],
      });
    });

    it('no guarda como alterno el mismo código principal del producto', async () => {
      await (service as any).sincronizarCodigosBarrasExtra(
        10,
        1,
        ['principal', 'EAN-B'],
        'PRINCIPAL',
      );
      expect(prisma.productoCodigoBarras.createMany).toHaveBeenCalledWith({
        data: [{ productoId: 10, empresaId: 1, ...suelto('EAN-B') }],
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
