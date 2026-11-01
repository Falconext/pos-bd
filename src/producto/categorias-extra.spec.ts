import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  MAX_CATEGORIAS_EXTRA,
  agregarFiltroCategoria,
  aplanarCategoriasExtra,
  condicionesCategoriaPorNombre,
  filtroPorCategoria,
  guardarCategoriasExtra,
  sanitizarCategoriasExtraIds,
  separarNombresCategorias,
  unirNombresCategorias,
  validarCategoriasExtra,
} from './categorias-extra.util';
import { ProductoService } from './producto.service';
import { CategoriaService } from '../categoria/categoria.service';
import { TiendaService } from '../tienda/tienda.service';

/**
 * Un producto en varias categorías: la principal sigue en categoriaId y las
 * adicionales solo sirven para encontrarlo (filtros, POS, tienda).
 */
describe('Categorías adicionales del producto', () => {
  describe('sanitizarCategoriasExtraIds', () => {
    it('undefined no toca nada; null y [] quitan todas', () => {
      expect(sanitizarCategoriasExtraIds(undefined, 1)).toBeUndefined();
      expect(sanitizarCategoriasExtraIds(null, 1)).toEqual([]);
      expect(sanitizarCategoriasExtraIds([], 1)).toEqual([]);
    });

    it('quita repetidos, basura y la categoría principal', () => {
      expect(
        sanitizarCategoriasExtraIds([3, '3', 5, 1, 0, -2, 'x', 2.5, null], 1),
      ).toEqual([3, 5]);
    });

    it('sin principal no descarta nada válido', () => {
      expect(sanitizarCategoriasExtraIds([4, 7], null)).toEqual([4, 7]);
    });

    it(`más de ${MAX_CATEGORIAS_EXTRA} es un error, no un recorte`, () => {
      const ids = Array.from({ length: MAX_CATEGORIAS_EXTRA + 1 }, (_, i) => i + 10);
      expect(() => sanitizarCategoriasExtraIds(ids, null)).toThrow(BadRequestException);
      // La principal repetida no cuenta para el tope.
      expect(sanitizarCategoriasExtraIds([...ids.slice(0, 10), 99], 99)).toHaveLength(10);
    });
  });

  describe('validar y guardar', () => {
    const crearPrisma = (propias: number[]) => {
      const prisma = {
        categoria: {
          findMany: jest.fn().mockResolvedValue(propias.map((id) => ({ id }))),
        },
        productoCategoriaExtra: {
          deleteMany: jest.fn().mockReturnValue('delete'),
          createMany: jest.fn().mockReturnValue('create'),
        },
        $transaction: jest.fn().mockResolvedValue([]),
      };
      return prisma;
    };

    it('rechaza una categoría de otra empresa sin escribir nada', async () => {
      const prisma = crearPrisma([3]);
      await expect(
        guardarCategoriasExtra(prisma as any, { productoId: 8, empresaId: 45, ids: [3, 77] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.categoria.findMany).toHaveBeenCalledWith({
        where: { id: { in: [3, 77] }, empresaId: 45 },
        select: { id: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('reemplaza el conjunto en una transacción', async () => {
      const prisma = crearPrisma([3, 5]);
      await guardarCategoriasExtra(prisma as any, { productoId: 8, empresaId: 45, ids: [3, 5] });
      expect(prisma.productoCategoriaExtra.deleteMany).toHaveBeenCalledWith({ where: { productoId: 8 } });
      expect(prisma.productoCategoriaExtra.createMany).toHaveBeenCalledWith({
        data: [
          { productoId: 8, categoriaId: 3 },
          { productoId: 8, categoriaId: 5 },
        ],
        skipDuplicates: true,
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(['delete', 'create']);
    });

    it('[] solo borra y no consulta categorías', async () => {
      const prisma = crearPrisma([]);
      await guardarCategoriasExtra(prisma as any, { productoId: 8, empresaId: 45, ids: [] });
      expect(prisma.categoria.findMany).not.toHaveBeenCalled();
      expect(prisma.productoCategoriaExtra.createMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(['delete']);
    });

    it('validar sin ids no consulta', async () => {
      const prisma = crearPrisma([]);
      await validarCategoriasExtra(prisma as any, 45, undefined);
      expect(prisma.categoria.findMany).not.toHaveBeenCalled();
    });
  });

  describe('filtros', () => {
    it('principal, adicional o adicional del padre (variantes)', () => {
      expect(filtroPorCategoria(7)).toEqual({
        OR: [
          { categoriaId: 7 },
          { categoriasExtra: { some: { categoriaId: 7 } } },
          { productoPadre: { categoriasExtra: { some: { categoriaId: 7 } } } },
        ],
      });
    });

    it('se suma al AND de la búsqueda sin pisar su OR', () => {
      const busqueda = [{ OR: [{ descripcion: { contains: 'polo' } }] }];
      const where = { empresaId: 1, AND: busqueda, OR: [{ a: 1 }] };
      const r = agregarFiltroCategoria(where, 7);
      expect(r.OR).toEqual([{ a: 1 }]);
      expect(r.AND).toEqual([...busqueda, filtroPorCategoria(7)]);
      // No muta el where original.
      expect(where.AND).toHaveLength(1);
    });

    it('sin AND previo, o con AND objeto, igual queda en lista', () => {
      expect(agregarFiltroCategoria({} as { AND?: unknown }, 7).AND).toEqual([filtroPorCategoria(7)]);
      expect(agregarFiltroCategoria({ AND: { x: 1 } }, 7).AND).toEqual([
        { x: 1 },
        filtroPorCategoria(7),
      ]);
    });

    it('categoría vacía o inválida no filtra', () => {
      const where = { AND: [] };
      expect(agregarFiltroCategoria(where, undefined)).toBe(where);
      expect(agregarFiltroCategoria(where, 0)).toBe(where);
    });

    it('tienda: por nombre, principal o adicional, sin mayúsculas', () => {
      const igual = { equals: 'Ofertas', mode: 'insensitive' };
      expect(condicionesCategoriaPorNombre(['Ofertas'])).toEqual([
        { categoria: { nombre: igual } },
        { categoriasExtra: { some: { categoria: { nombre: igual } } } },
      ]);
    });
  });

  describe('Excel CATEGORIAS_EXTRA', () => {
    it('separa con | y, sin |, con coma o punto y coma', () => {
      expect(separarNombresCategorias(' Ofertas | Regalos |  | ofertas ')).toEqual(['Ofertas', 'Regalos']);
      expect(separarNombresCategorias('Ofertas, Regalos;Navidad')).toEqual(['Ofertas', 'Regalos', 'Navidad']);
      expect(separarNombresCategorias('Ropa, hombre | Ofertas')).toEqual(['Ropa, hombre', 'Ofertas']);
      expect(separarNombresCategorias(null)).toEqual([]);
      expect(separarNombresCategorias('   ')).toEqual([]);
    });

    it('ida y vuelta: lo que exporta se vuelve a leer igual', () => {
      const cats = [
        { id: 1, nombre: 'Ofertas' },
        { id: 2, nombre: 'Más vendidos' },
      ];
      expect(separarNombresCategorias(unirNombresCategorias(cats))).toEqual(['Ofertas', 'Más vendidos']);
    });

    it('aplana la tabla puente', () => {
      expect(
        aplanarCategoriasExtra([{ categoria: { id: 1, nombre: 'A' } }, { categoria: null as any }]),
      ).toEqual([{ id: 1, nombre: 'A' }]);
      expect(aplanarCategoriasExtra(undefined)).toEqual([]);
    });
  });

  describe('cambio rápido de categoría principal', () => {
    it('si la nueva principal era adicional, deja de serlo', async () => {
      const prisma = {
        producto: {
          findFirst: jest.fn().mockResolvedValue({ id: 5 }),
          update: jest.fn().mockResolvedValue({
            id: 5,
            categoriaId: 9,
            categoria: { id: 9, nombre: 'Polos' },
            categoriasExtra: [{ categoria: { id: 3, nombre: 'Ofertas' } }],
          }),
        },
        categoria: { findFirst: jest.fn().mockResolvedValue({ id: 9 }) },
        productoCategoriaExtra: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      } as any;
      const service = Object.create(ProductoService.prototype);
      service.prisma = prisma;
      const r = await service.cambiarCategoria(5, 45, 9);
      expect(prisma.productoCategoriaExtra.deleteMany).toHaveBeenCalledWith({
        where: { productoId: 5, categoriaId: 9 },
      });
      expect(r.categoriasExtra).toEqual([{ id: 3, nombre: 'Ofertas' }]);
    });

    it('categoría de otra empresa: no toca nada', async () => {
      const prisma = {
        producto: { findFirst: jest.fn().mockResolvedValue({ id: 5 }), update: jest.fn() },
        categoria: { findFirst: jest.fn().mockResolvedValue(null) },
        productoCategoriaExtra: { deleteMany: jest.fn() },
      } as any;
      const service = Object.create(ProductoService.prototype);
      service.prisma = prisma;
      await expect(service.cambiarCategoria(5, 45, 9)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productoCategoriaExtra.deleteMany).not.toHaveBeenCalled();
      expect(prisma.producto.update).not.toHaveBeenCalled();
    });
  });

  describe('conteo de productos por categoría', () => {
    it('suma los que la tienen como principal y como adicional', async () => {
      const prisma = {
        categoria: {
          findMany: jest.fn().mockResolvedValue([
            { id: 1, nombre: 'Polos', _count: { productos: 4, productosExtra: 2 } },
            { id: 2, nombre: 'Ofertas', _count: { productos: 0, productosExtra: 3 } },
          ]),
        },
      } as any;
      const service = new CategoriaService(prisma, {} as any);
      const r = await service.listar(45);
      expect(r).toEqual([
        { id: 1, nombre: 'Polos', _count: { productos: 6 } },
        { id: 2, nombre: 'Ofertas', _count: { productos: 3 } },
      ]);
      const args = prisma.categoria.findMany.mock.calls[0][0];
      expect(args.include._count.select.productosExtra).toEqual({
        where: { producto: { estado: { in: ['ACTIVO', 'INACTIVO'] } } },
      });
    });
  });

  describe('menú de categorías de la tienda', () => {
    it('incluye una categoría que solo aparece como adicional, sin repetir', async () => {
      const prisma = {
        empresa: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 45, plan: { tieneTienda: true } }),
        },
        sede: { findMany: jest.fn().mockResolvedValue([]) },
        producto: {
          count: jest.fn().mockResolvedValue(3),
          findMany: jest.fn().mockResolvedValue([
            {
              categoria: { id: 1, nombre: 'Polos', imagenUrl: null },
              categoriasExtra: [{ categoria: { id: 3, nombre: 'Ofertas', imagenUrl: 'x.png' } }],
            },
            {
              categoria: { id: 3, nombre: 'Ofertas', imagenUrl: 'x.png' },
              categoriasExtra: [{ categoria: { id: 1, nombre: 'Polos', imagenUrl: null } }],
            },
            { categoria: null, categoriasExtra: [{ categoria: { id: 4, nombre: 'Navidad', imagenUrl: null } }] },
          ]),
        },
      } as any;
      const service = Object.create(TiendaService.prototype);
      service.prisma = prisma;
      service.s3 = { getSignedGetUrl: jest.fn() };
      const r = await service.obtenerCategoriasTienda('demo');
      expect(r.map((c: any) => c.nombre)).toEqual(['Navidad', 'Ofertas', 'Polos']);
      const where = prisma.producto.findMany.mock.calls[0][0].where;
      // Misma elegibilidad que el listado: activos de la empresa, publicados,
      // con el filtro de stock de la tienda.
      expect(where).toMatchObject({ empresaId: 45, estado: 'ACTIVO', publicarEnTienda: true });
    });
  });
});
