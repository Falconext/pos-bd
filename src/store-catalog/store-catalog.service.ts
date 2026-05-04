import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreProductDto, FilterStoreProductDto, UpdateStoreProductDto } from './dto/store-product.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class StoreCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPublic(filters: FilterStoreProductDto = {}) {
    const { category, minPrice, maxPrice, inStock, search, sortBy } = filters;

    const where: Prisma.StoreProductWhereInput = {
      isActive: true,
    };

    // Category filter
    if (category) {
      where.category = category;
    }

    // Price filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    // Stock / availability filter
    if (inStock === true) {
      // In stock: stock is null (unknown/unlimited) OR stock > 0
      where.OR = [{ stock: null }, { stock: { gt: 0 } }];
    } else if (inStock === false) {
      // Out of stock: stock === 0
      where.stock = 0;
    }

    // Search by name
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    // Sort order
    let orderBy: Prisma.StoreProductOrderByWithRelationInput[] = [{ order: 'asc' }];
    if (sortBy === 'name_asc') orderBy = [{ name: 'asc' }];
    else if (sortBy === 'name_desc') orderBy = [{ name: 'desc' }];
    else if (sortBy === 'price_asc') orderBy = [{ price: 'asc' }];
    else if (sortBy === 'price_desc') orderBy = [{ price: 'desc' }];

    return this.prisma.storeProduct.findMany({
      where,
      orderBy,
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        oldPrice: true,
        imageUrl: true,
        badge: true,
        category: true,
        stock: true,
      },
    });
  }

  /** Returns available categories + count for sidebar */
  async getPublicMeta() {
    const categories = await this.prisma.storeProduct.groupBy({
      by: ['category'],
      where: { isActive: true, category: { not: null } },
      _count: { id: true },
      orderBy: { category: 'asc' },
    });

    const inStockCount = await this.prisma.storeProduct.count({
      where: { isActive: true, OR: [{ stock: null }, { stock: { gt: 0 } }] },
    });
    const outOfStockCount = await this.prisma.storeProduct.count({
      where: { isActive: true, stock: 0 },
    });

    const priceRange = await this.prisma.storeProduct.aggregate({
      where: { isActive: true },
      _min: { price: true },
      _max: { price: true },
    });

    return {
      categories: categories.map(c => ({ name: c.category, count: c._count.id })),
      availability: { inStock: inStockCount, outOfStock: outOfStockCount },
      priceRange: {
        min: Number(priceRange._min.price ?? 0),
        max: Number(priceRange._max.price ?? 9999),
      },
    };
  }

  /** Obtener el detalle público de un solo producto */
  async findOnePublic(id: number) {
    const product = await this.prisma.storeProduct.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        oldPrice: true,
        imageUrl: true,
        badge: true,
        category: true,
        stock: true,
      },
    });

    if (!product) throw new NotFoundException(`Producto #${id} no encontrado o inactivo`);
    return product;
  }

  async findAll() {
    return this.prisma.storeProduct.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] });
  }

  async create(dto: CreateStoreProductDto) {
    return this.prisma.storeProduct.create({ data: dto });
  }

  async update(id: number, dto: UpdateStoreProductDto) {
    await this.findOneOrFail(id);
    return this.prisma.storeProduct.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOneOrFail(id);
    return this.prisma.storeProduct.delete({ where: { id } });
  }

  private async findOneOrFail(id: number) {
    const product = await this.prisma.storeProduct.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Producto #${id} no encontrado`);
    return product;
  }
}
