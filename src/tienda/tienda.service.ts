import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { ConfigurarTiendaDto } from './dto/configurar-tienda.dto';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { ActualizarEstadoPedidoDto } from './dto/actualizar-pedido.dto';

import { DisenoRubroService } from '../diseno-rubro/diseno-rubro.service';

@Injectable()
export class TiendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly disenoService: DisenoRubroService,
  ) { }

  // ==================== CONFIGURACIÓN DE TIENDA ====================

  async configurarTienda(empresaId: number, dto: ConfigurarTiendaDto) {
    // Verificar que la empresa tenga plan con tienda
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { plan: true },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    if (!empresa.plan.tieneTienda) {
      throw new ForbiddenException(
        'Tu plan actual no incluye tienda virtual. Actualiza tu plan para activar esta funcionalidad.',
      );
    }

    // Si se está cambiando el slug, verificar que no exista
    if (dto.slugTienda && dto.slugTienda !== empresa.slugTienda) {
      const existeSlug = await this.prisma.empresa.findUnique({
        where: { slugTienda: dto.slugTienda },
      });

      if (existeSlug) {
        throw new BadRequestException('Este nombre de tienda ya está en uso');
      }
    }

    return this.prisma.empresa.update({
      where: { id: empresaId },
      data: dto,
      select: {
        id: true,
        slugTienda: true,
        descripcionTienda: true,
        whatsappTienda: true,
        facebookUrl: true,
        instagramUrl: true,
        tiktokUrl: true,
        horarioAtencion: true,
        colorPrimario: true,
        colorSecundario: true,
        yapeQrUrl: true,
        yapeNumero: true,
        plinQrUrl: true,
        plinNumero: true,
        aceptaEfectivo: true,
        // Devolver también campos de envío/recojo para que el frontend los persista
        costoEnvioFijo: true,
        aceptaRecojo: true,
        aceptaEnvio: true,
        direccionRecojo: true,
        tiempoPreparacionMin: true,
        // Información Bancaria
        bancoNombre: true,
        numeroCuenta: true,
        cci: true,
        monedaCuenta: true,
      },
    });
  }

  async obtenerConfiguracionTienda(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        slugTienda: true,
        descripcionTienda: true,
        whatsappTienda: true,
        facebookUrl: true,
        instagramUrl: true,
        tiktokUrl: true,
        horarioAtencion: true,
        colorPrimario: true,
        colorSecundario: true,
        yapeQrUrl: true,
        yapeNumero: true,
        plinQrUrl: true,
        plinNumero: true,
        aceptaEfectivo: true,
        esAgenteRetencion: true,
        // Campos de envío/recojo
        costoEnvioFijo: true,
        aceptaRecojo: true,
        aceptaEnvio: true,
        direccionRecojo: true,
        tiempoPreparacionMin: true,
        // Información Bancaria
        bancoNombre: true,
        numeroCuenta: true,
        cci: true,
        monedaCuenta: true,
        plan: {
          select: {
            tieneTienda: true,
          },
        },
      },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    // Firmar si son objetos S3 (para vista previa en admin)
    const signIfS3 = async (url?: string | null) => {
      try {
        if (!url) return url as any;
        const idx = url.indexOf('amazonaws.com/');
        if (idx === -1) return url as any;
        const key = url.substring(idx + 'amazonaws.com/'.length);
        if (!key) return url as any;
        const signed = await this.s3.getSignedGetUrl(key, 600);
        return signed || (url as any);
      } catch {
        return url as any;
      }
    };

    return {
      ...empresa,
      yapeQrSignedUrl: await signIfS3(empresa.yapeQrUrl as any),
      plinQrSignedUrl: await signIfS3(empresa.plinQrUrl as any),
    } as any;
  }

  // ==================== UPLOADS (QRs) ====================

  async subirQr(
    empresaId: number,
    tipo: 'yape' | 'plin',
    file: { buffer: Buffer; mimetype?: string },
  ) {
    if (!file || !file.buffer)
      throw new BadRequestException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct))
      throw new BadRequestException('El archivo debe ser una imagen');

    const s3Key = this.s3.generateTiendaQrKey(empresaId, tipo, ct);
    const url = await this.s3.uploadImage(file.buffer, s3Key, ct);

    const data: any = {};
    if (tipo === 'yape') data.yapeQrUrl = url;
    if (tipo === 'plin') data.plinQrUrl = url;

    await this.prisma.empresa.update({ where: { id: empresaId }, data });
    // Devolver también URL firmada para previsualizar inmediatamente
    const idx = url.indexOf('amazonaws.com/');
    const objKey = idx !== -1 ? url.substring(idx + 'amazonaws.com/'.length) : '';
    const signedUrl = objKey ? await this.s3.getSignedGetUrl(objKey, 600) : url;
    return { url, signedUrl };
  }

  // ==================== TIENDA PÚBLICA ====================

  async obtenerTiendaPorSlug(slug: string) {
    try {
      const empresa = await this.prisma.empresa.findUnique({
        where: { slugTienda: slug },
        select: {
          id: true,
          nombreComercial: true,
          razonSocial: true,
          logo: true,
          descripcionTienda: true,
          whatsappTienda: true,
          facebookUrl: true,
          instagramUrl: true,
          tiktokUrl: true,
          horarioAtencion: true,
          colorPrimario: true,
          colorSecundario: true,
          // Campos de envío/recojo visibles en tienda pública
          costoEnvioFijo: true,
          aceptaRecojo: true,
          aceptaEnvio: true,
          direccionRecojo: true,
          tiempoPreparacionMin: true,
          direccion: true,
          distrito: true,
          provincia: true,
          departamento: true,
          rubro: {
            select: {
              nombre: true,
            },
          },
          plan: {
            select: {
              tieneTienda: true,
            },
          },
          banners: {
            where: { activo: true },
            orderBy: { orden: 'asc' },
            select: {
              id: true,
              titulo: true,
              subtitulo: true,
              imagenUrl: true,
              linkUrl: true,
              orden: true,
              activo: true,
            }
          },
        },
      });

      if (!empresa) {
        console.error('obtenerTiendaPorSlug: Tienda no encontrada para slug', slug);
        throw new NotFoundException('Tienda no encontrada');
      }

      // Firmar banners si existen
      if (empresa.banners && empresa.banners.length > 0) {
        await Promise.all(
          empresa.banners.map(async (banner) => {
            if (banner.imagenUrl && banner.imagenUrl.includes('amazonaws.com')) {
              const urlParts = banner.imagenUrl.split('amazonaws.com/');
              if (urlParts.length > 1) {
                const key = urlParts[1];
                try {
                  banner.imagenUrl = await this.s3.getSignedGetUrl(key);
                } catch (e) {
                  console.error('Error signing banner:', e);
                }
              }
            }
          }),
        );
      }

      if (!empresa.plan.tieneTienda) {
        console.error('obtenerTiendaPorSlug: Plan sin tienda', slug);
        throw new ForbiddenException('Esta tienda no está disponible');
      }

      const diseno = await this.disenoService.obtenerDisenoPorEmpresa(empresa.id).catch(e => {
        console.error('Error obteniendo diseño:', e);
        return {}; // Fallback en caso de error de diseño
      });

      return {
        ...empresa,
        diseno,
      };
    } catch (e) {
      console.error('Error in obtenerTiendaPorSlug:', e);
      throw e;
    }
  }

  async obtenerCategoriasTienda(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    // Get all unique categories from active products with stock
    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId: empresa.id,
        estado: 'ACTIVO',
        stock: { gt: 0 },
      },
      select: {
        categoria: {
          select: {
            id: true,
            nombre: true,
            imagenUrl: true,
          },
        },
      },
    });

    const categoriasMap = new Map<string, any>();

    productos.forEach((p) => {
      if (p.categoria?.nombre) {
        if (!categoriasMap.has(p.categoria.nombre)) {
          categoriasMap.set(p.categoria.nombre, {
            nombre: p.categoria.nombre,
            imagenUrl: p.categoria.imagenUrl,
          });
        }
      }
    });

    const result = Array.from(categoriasMap.values()).sort((a, b) =>
      a.nombre.localeCompare(b.nombre),
    );

    // Sign URLs if needed
    await Promise.all(
      result.map(async (cat) => {
        if (cat.imagenUrl && cat.imagenUrl.includes('amazonaws.com')) {
          const parts = cat.imagenUrl.split('amazonaws.com/');
          if (parts.length > 1) {
            try {
              cat.imagenUrl = await this.s3.getSignedGetUrl(parts[1]);
            } catch (e) {
              console.error('Error signing category image:', e);
            }
          }
        }
      }),
    );

    return result;
  }

  async obtenerMarcasTienda(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    // Get all unique brands from active products with stock
    const productos = await this.prisma.producto.findMany({
      where: {
        empresaId: empresa.id,
        estado: 'ACTIVO',
        stock: { gt: 0 },
        marcaId: { not: null }, // Only products with brand
      },
      select: {
        marca: {
          select: {
            id: true,
            nombre: true,
            imagenUrl: true,
          },
        },
      },
    });

    const marcasMap = new Map<string, any>();

    productos.forEach((p) => {
      if (p.marca?.nombre && p.marca?.imagenUrl) {
        if (!marcasMap.has(p.marca.nombre)) {
          marcasMap.set(p.marca.nombre, {
            nombre: p.marca.nombre,
            imagenUrl: p.marca.imagenUrl,
          });
        }
      }
    });

    const result = Array.from(marcasMap.values()).sort((a, b) =>
      a.nombre.localeCompare(b.nombre),
    );

    // Sign URLs if needed
    await Promise.all(
      result.map(async (marca) => {
        if (marca.imagenUrl && marca.imagenUrl.includes('amazonaws.com')) {
          const parts = marca.imagenUrl.split('amazonaws.com/');
          if (parts.length > 1) {
            try {
              marca.imagenUrl = await this.s3.getSignedGetUrl(parts[1]);
            } catch (e) {
              console.error('Error signing brand image:', e);
            }
          }
        }
      }),
    );

    return result;
  }

  async obtenerRangoPreciosTienda(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    // Get min and max prices from active products with stock
    const result = await this.prisma.producto.aggregate({
      where: {
        empresaId: empresa.id,
        estado: 'ACTIVO',
        stock: { gt: 0 },
      },
      _min: { precioUnitario: true },
      _max: { precioUnitario: true },
    });

    return {
      min: Number(result._min.precioUnitario || 0),
      max: Number(result._max.precioUnitario || 1000),
    };
  }

  async obtenerProductosTienda(slug: string, page = 1, limit = 30, search = '', category = '', minPrice?: number, maxPrice?: number, brand = '', wholesale = false) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });

    try {
      if (!empresa) {
        throw new NotFoundException('Tienda no encontrada');
      }
      console.log('obtenerProductosTienda', { slug, page, limit, search, category, minPrice, maxPrice, brand });

      const signIfS3 = async (url?: string | null) => {
        try {
          if (!url) return url as any;
          const idx = url.indexOf('amazonaws.com/');
          if (idx === -1) return url as any;
          const key = url.substring(idx + 'amazonaws.com/'.length);
          if (!key) return url as any;
          const signed = await this.s3.getSignedGetUrl(key, 600);
          return signed || (url as any);
        } catch { return url as any; }
      };

      const skip = Math.max(0, (Number(page) || 1) - 1) * (Number(limit) || 30);
      const take = Math.max(1, Math.min(100, Number(limit) || 30));

      const select = {
        id: true,
        codigo: true,
        descripcion: true,
        descripcionLarga: true,
        precioUnitario: true,
        stock: true,
        imagenUrl: true,
        imagenesExtra: true,
        destacado: true,
        ratingAvg: true,
        ratingCount: true,
        categoria: { select: { id: true, nombre: true } },
        unidadMedida: { select: { codigo: true, nombre: true } },
        marca: { select: { id: true, nombre: true } },
      } as const;

      const baseOrder = [{ destacado: 'desc' as const }, { descripcion: 'asc' as const }];

      const wherePublicados: any = {
        empresaId: empresa.id,
        publicarEnTienda: true,
        estado: 'ACTIVO' as const,
        stock: { gt: 0 },
      };
      const term = (search || '').trim();
      if (term) {
        wherePublicados.OR = [
          { descripcion: { contains: term, mode: 'insensitive' } },
          { codigo: { contains: term, mode: 'insensitive' } },
        ];
      }

      // Filtro por rango de precios
      if (minPrice !== undefined || maxPrice !== undefined) {
        const priceFilter: any = {};
        if (minPrice !== undefined) priceFilter.gte = minPrice;
        if (maxPrice !== undefined) priceFilter.lte = maxPrice;
        wherePublicados.precioUnitario = priceFilter;
      }

      // Filtro por mayorista
      if (wholesale) {
        wherePublicados.gruposModificadores = {
          some: {
            grupo: {
              nombre: { contains: 'Precios', mode: 'insensitive' }
            }
          }
        };
      }

      // Filtro por marcas
      if (brand && brand.trim()) {
        const brands = brand.split(',').map((b) => b.trim()).filter(Boolean);
        if (brands.length > 0) {
          const brandConditions = brands.map((brandName) => ({
            marca: {
              nombre: { equals: brandName, mode: 'insensitive' as const },
            },
          }));

          if (wherePublicados.OR) {
            const existingOR = wherePublicados.OR;
            delete wherePublicados.OR;
            if (!wherePublicados.AND) wherePublicados.AND = [];
            wherePublicados.AND.push({ OR: existingOR });
            wherePublicados.AND.push({ OR: brandConditions });
          } else {
            if (!wherePublicados.AND) wherePublicados.AND = [];
            wherePublicados.AND.push({ OR: brandConditions });
          }
        }
      }

      // Filtro por categorías - use OR conditions for case-insensitive matching
      if (category && category.trim()) {
        const cats = category.split(',').map((c) => c.trim()).filter(Boolean);
        if (cats.length > 0) {
          // Build OR conditions for each category name
          const categoryConditions = cats.map((catName) => ({
            categoria: {
              nombre: { equals: catName, mode: 'insensitive' as const },
            },
          }));

          // If there's already an OR condition (from search), we need to AND them
          if (wherePublicados.OR) {
            const existingOR = wherePublicados.OR;
            delete wherePublicados.OR;
            if (!wherePublicados.AND) wherePublicados.AND = [];
            wherePublicados.AND.push({ OR: existingOR });
            wherePublicados.AND.push({ OR: categoryConditions });
          } else {
            if (!wherePublicados.AND) wherePublicados.AND = [];
            wherePublicados.AND.push({ OR: categoryConditions });
          }
        }
      }

      console.log('wherePublicados count', JSON.stringify(wherePublicados));
      const countPublicados = await this.prisma.producto.count({ where: wherePublicados });

      if (countPublicados > 0) {
        const itemsRaw = await this.prisma.producto.findMany({
          where: wherePublicados,
          select,
          orderBy: baseOrder,
          skip,
          take,
        });
        const items = await Promise.all(
          itemsRaw.map(async (p: any) => ({
            ...p,
            imagenUrl: await signIfS3(p.imagenUrl),
            imagenesExtra: Array.isArray(p.imagenesExtra)
              ? await Promise.all(p.imagenesExtra.map((u: string) => signIfS3(u)))
              : p.imagenesExtra,
          }))
        );
        return { data: items, total: countPublicados, page: Number(page) || 1, limit: take };
      }

      // Fallback: activos con stock>0
      console.log('obtenerProductosTienda fallback active');
      const whereActivos: any = {
        empresaId: empresa.id,
        estado: 'ACTIVO' as const,
        stock: { gt: 0 },
      };
      if (term) {
        whereActivos.OR = [
          { descripcion: { contains: term, mode: 'insensitive' } },
          { codigo: { contains: term, mode: 'insensitive' } },
        ];
      }

      if (minPrice !== undefined || maxPrice !== undefined) {
        const priceFilter: any = {};
        if (minPrice !== undefined) priceFilter.gte = minPrice;
        if (maxPrice !== undefined) priceFilter.lte = maxPrice;
        whereActivos.precioUnitario = priceFilter;
      }

      if (wholesale) {
        whereActivos.gruposModificadores = {
          some: {
            grupo: {
              nombre: { contains: 'Precios', mode: 'insensitive' }
            }
          }
        };
      }

      // Fallback filtering for brand
      if (brand && brand.trim()) {
        const brands = brand.split(',').map((b) => b.trim()).filter(Boolean);
        if (brands.length > 0) {
          const brandConditions = brands.map((brandName) => ({
            marca: {
              nombre: { equals: brandName, mode: 'insensitive' as const },
            },
          }));
          if (whereActivos.OR) {
            const existingOR = whereActivos.OR;
            delete whereActivos.OR;
            if (!whereActivos.AND) whereActivos.AND = [];
            whereActivos.AND.push({ OR: existingOR });
            whereActivos.AND.push({ OR: brandConditions });
          } else {
            if (!whereActivos.AND) whereActivos.AND = [];
            whereActivos.AND.push({ OR: brandConditions });
          }
        }
      }

      // Fallback filtering for category
      if (category && category.trim()) {
        const cats = category.split(',').map((c) => c.trim()).filter(Boolean);
        if (cats.length > 0) {
          const categoryConditions = cats.map((catName) => ({
            categoria: {
              nombre: { equals: catName, mode: 'insensitive' as const },
            },
          }));
          if (whereActivos.OR) {
            const existingOR = whereActivos.OR;
            delete whereActivos.OR;
            if (!whereActivos.AND) whereActivos.AND = [];
            whereActivos.AND.push({ OR: existingOR });
            whereActivos.AND.push({ OR: categoryConditions });
          } else {
            if (!whereActivos.AND) whereActivos.AND = [];
            whereActivos.AND.push({ OR: categoryConditions });
          }
        }
      }

      const total = await this.prisma.producto.count({ where: whereActivos });
      const itemsRaw = await this.prisma.producto.findMany({
        where: whereActivos,
        select,
        orderBy: baseOrder,
        skip,
        take,
      });

      const items = await Promise.all(
        itemsRaw.map(async (p: any) => ({
          ...p,
          imagenUrl: await signIfS3(p.imagenUrl),
          imagenesExtra: Array.isArray(p.imagenesExtra)
            ? await Promise.all(p.imagenesExtra.map((u: string) => signIfS3(u)))
            : p.imagenesExtra,
        }))
      );

      return { data: items, total, page: Number(page) || 1, limit: take };

    } catch (e: any) {
      console.error('Error in obtenerProductosTienda:', e);
      if (e?.code === 'P2002') console.error('Prisma Unique constraint failed');
      throw e;
    }
  }

  async obtenerProductosRelacionados(slug: string, id: number, limit = 10) {
    const tienda = await this.obtenerTiendaPorSlug(slug);
    const producto = await this.prisma.producto.findUnique({
      where: { id },
      select: { categoriaId: true },
    });

    if (!producto) throw new NotFoundException('Producto no encontrado');

    let related: any[] = [];

    // 1. Try fetching by same category, excluding current
    if (producto.categoriaId) {
      related = await this.prisma.producto.findMany({
        where: {
          empresaId: tienda.id,
          categoriaId: producto.categoriaId,
          id: { not: id },
          estado: 'ACTIVO',
          stock: { gt: 0 }
        },
        take: 20, // Fetch more to shuffle
        select: {
          id: true,
          descripcion: true,
          precioUnitario: true,
          imagenUrl: true,
          categoria: { select: { nombre: true } },
          stock: true,

        }
      });
    }

    // 2. If not enough, fetch random active products
    if (related.length < limit) {
      const more = await this.prisma.producto.findMany({
        where: {
          empresaId: tienda.id,
          id: { not: id }, // and not in related? (simplified for now)
          estado: 'ACTIVO',
          stock: { gt: 0 }
        },
        take: 20,
        select: {
          id: true,
          descripcion: true,
          precioUnitario: true,
          imagenUrl: true,
          categoria: { select: { nombre: true } },
          stock: true,

        }
      });

      // Merge and deduplicate
      const seen = new Set(related.map(p => p.id));
      more.forEach(p => {
        if (!seen.has(p.id)) {
          related.push(p);
          seen.add(p.id);
        }
      });
    }

    // Shuffle array
    related = related.sort(() => 0.5 - Math.random()).slice(0, limit);

    // Sign images
    const signIfS3 = async (url?: string | null) => {
      try {
        if (!url) return url as any;
        const idx = url.indexOf('amazonaws.com/');
        if (idx === -1) return url as any;
        const key = url.substring(idx + 'amazonaws.com/'.length);
        if (!key) return url as any;
        return await this.s3.getSignedGetUrl(key, 600);
      } catch { return url as any; }
    };

    return Promise.all(related.map(async p => ({
      ...p,
      imagenUrl: await signIfS3(p.imagenUrl)
    })));
  }



  async obtenerProductoDetalle(slug: string, productoId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    const select = {
      id: true,
      codigo: true,
      descripcion: true,
      descripcionLarga: true,
      precioUnitario: true,
      stock: true,
      imagenUrl: true,
      imagenesExtra: true,
      destacado: true,
      ratingAvg: true,
      ratingCount: true,
      categoria: {
        select: {
          id: true,
          nombre: true,
        },
      },
      unidadMedida: {
        select: {
          codigo: true,
          nombre: true,
        },
      },
    } as const;

    // Primero intentar con publicarEnTienda=true
    let producto = await this.prisma.producto.findFirst({
      where: {
        id: productoId,
        empresaId: empresa.id,
        publicarEnTienda: true,
        estado: 'ACTIVO',
      },
      select,
    });

    // Fallback: ACTIVO con stock>0 aunque no esté marcado para publicar
    if (!producto) {
      producto = await this.prisma.producto.findFirst({
        where: {
          id: productoId,
          empresaId: empresa.id,
          estado: 'ACTIVO',
          stock: { gt: 0 },
        },
        select,
      });
    }

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Firmar imágenes si son S3
    const signIfS3 = async (url?: string | null) => {
      try {
        if (!url) return url as any;
        const idx = url.indexOf('amazonaws.com/');
        if (idx === -1) return url as any;
        const key = url.substring(idx + 'amazonaws.com/'.length);
        if (!key) return url as any;
        const signed = await this.s3.getSignedGetUrl(key, 600);
        return signed || (url as any);
      } catch { return url as any; }
    };

    const imagenesExtraFirmadas = Array.isArray((producto as any).imagenesExtra)
      ? await Promise.all(((producto as any).imagenesExtra as string[]).map((u) => signIfS3(u)))
      : (producto as any).imagenesExtra;

    return {
      ...producto,
      imagenUrl: await signIfS3((producto as any).imagenUrl as any),
      imagenesExtra: imagenesExtraFirmadas as any,
    } as any;
  }

  async obtenerConfiguracionPago(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: {
        yapeQrUrl: true,
        yapeNumero: true,
        plinQrUrl: true,
        plinNumero: true,
        aceptaEfectivo: true,
        whatsappTienda: true,
      },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    // Si el bucket es privado, firmar URLs de S3 para visualización
    const signIfS3 = async (url?: string | null) => {
      try {
        if (!url) return url;
        // Detectar URL de S3 y extraer key
        const idx = url.indexOf('amazonaws.com/');
        if (idx === -1) return url; // no es S3
        const key = url.substring(idx + 'amazonaws.com/'.length);
        if (!key) return url;
        const signed = await this.s3.getSignedGetUrl(key, 600);
        return signed || url;
      } catch {
        return url;
      }
    };

    return {
      yapeQrUrl: await signIfS3(empresa.yapeQrUrl),
      yapeNumero: empresa.yapeNumero,
      plinQrUrl: await signIfS3(empresa.plinQrUrl),
      plinNumero: empresa.plinNumero,
      aceptaEfectivo: empresa.aceptaEfectivo,
      whatsappTienda: empresa.whatsappTienda,
    };
  }

  async obtenerConfiguracionEnvioPublica(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: {
        costoEnvioFijo: true,
        aceptaRecojo: true,
        aceptaEnvio: true,
        direccionRecojo: true,
        tiempoPreparacionMin: true,
        direccion: true,
      },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    return empresa;
  }

  // ==================== PEDIDOS ====================

  async crearPedido(slug: string, dto: CrearPedidoDto) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: {
        id: true,
        costoEnvioFijo: true,
        aceptaRecojo: true,
        aceptaEnvio: true,
      },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    // Validar tipo de entrega
    const tipoEntrega = dto.tipoEntrega || 'RECOJO';
    if (tipoEntrega === 'RECOJO' && !empresa.aceptaRecojo) {
      throw new BadRequestException('Esta tienda no acepta pedidos para recojo');
    }
    if (tipoEntrega === 'ENVIO' && !empresa.aceptaEnvio) {
      throw new BadRequestException('Esta tienda no acepta pedidos con envío');
    }

    // Validar dirección si es envío
    if (tipoEntrega === 'ENVIO' && !dto.clienteDireccion) {
      throw new BadRequestException('La dirección es obligatoria para pedidos con envío');
    }

    // Calcular costo de envío
    const costoEnvio = tipoEntrega === 'ENVIO'
      ? Number(empresa.costoEnvioFijo || 0)
      : 0;

    // Validar productos y calcular totales
    let subtotal = 0;
    const itemsData: {
      productoId: number;
      cantidad: number;
      precioUnit: number;
      subtotal: number;
      observacion?: string;
    }[] = [];

    for (const item of dto.items) {
      // Buscar producto con fallback: priorizar publicados, sino ACTIVO con stock
      let producto = await this.prisma.producto.findFirst({
        where: {
          id: item.productoId,
          empresaId: empresa.id,
          publicarEnTienda: true,
          estado: 'ACTIVO',
        },
      });

      // Fallback: si no está publicado, intentar con ACTIVO y stock > 0
      if (!producto) {
        producto = await this.prisma.producto.findFirst({
          where: {
            id: item.productoId,
            empresaId: empresa.id,
            estado: 'ACTIVO',
            stock: { gt: 0 },
          },
        });
      }

      if (!producto) {
        throw new BadRequestException(
          `Producto con ID ${item.productoId} no disponible o sin stock`,
        );
      }

      if (producto.stock < item.cantidad) {
        throw new BadRequestException(
          `Stock insuficiente para ${producto.descripcion}. Disponible: ${producto.stock}`,
        );
      }

      const precioUnit = Number(producto.precioUnitario);
      const itemSubtotal = precioUnit * item.cantidad;
      subtotal += itemSubtotal;

      itemsData.push({
        productoId: item.productoId,
        cantidad: item.cantidad,
        precioUnit,
        subtotal: itemSubtotal,
        observacion: item.observacion,
      });
    }

    // Los precios ya incluyen IGV, así que extraemos el IGV del subtotal
    // IGV = Subtotal - (Subtotal / 1.18)
    const igv = subtotal - (subtotal / 1.18);
    const total = subtotal + costoEnvio;

    // Generar un código de seguimiento único y corto
    const codigoSeguimiento = `PT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

    // Crear pedido
    const pedido = await this.prisma.pedidoTienda.create({
      data: {
        empresaId: empresa.id,
        codigoSeguimiento,
        clienteNombre: dto.clienteNombre,
        clienteTelefono: dto.clienteTelefono,
        clienteEmail: dto.clienteEmail,
        clienteDireccion: dto.clienteDireccion,
        clienteReferencia: dto.clienteReferencia,
        tipoEntrega,
        costoEnvio,
        subtotal,
        igv,
        total,
        medioPago: dto.medioPago,
        observaciones: dto.observaciones,
        referenciaTransf: dto.referenciaTransf,
        items: {
          create: itemsData,
        },
      },
      include: {
        items: {
          include: {
            producto: {
              select: {
                descripcion: true,
                imagenUrl: true,
              },
            },
          },
        },
      },
    });

    // Crear registro inicial en historial de estados
    await this.prisma.historialEstadoPedido.create({
      data: {
        pedidoId: pedido.id,
        estadoAnterior: null,
        estadoNuevo: 'PENDIENTE',
        notas: 'Pedido creado',
      },
    });

    return pedido;
  }

  private generarCodigoSeguimiento(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `PED-${timestamp}-${random}`;
  }

  async listarPedidos(empresaId: number, estado?: string, page = 1, limit = 50) {
    const where: any = { empresaId };

    if (estado) {
      where.estado = estado;
    }

    // Pagination
    const skip = Math.max(0, (Number(page) || 1) - 1) * (Number(limit) || 50);
    const take = Math.max(1, Math.min(100, Number(limit) || 50)); // Max 100 per request

    // Get total count for pagination info
    const total = await this.prisma.pedidoTienda.count({ where });

    const data = await this.prisma.pedidoTienda.findMany({
      where,
      include: {
        items: {
          include: {
            producto: {
              select: {
                descripcion: true,
                imagenUrl: true,
              },
            },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      skip,
      take,
    });

    return {
      data,
      total,
      page: Number(page) || 1,
      limit: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async obtenerPedido(empresaId: number, pedidoId: number) {
    const pedido = await this.prisma.pedidoTienda.findFirst({
      where: {
        id: pedidoId,
        empresaId,
      },
      include: {
        items: {
          include: {
            producto: {
              select: {
                descripcion: true,
                imagenUrl: true,
                codigo: true,
              },
            },
          },
        },
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return pedido;
  }

  async actualizarEstadoPedido(
    empresaId: number,
    pedidoId: number,
    dto: ActualizarEstadoPedidoDto,
  ) {
    const pedido = await this.prisma.pedidoTienda.findFirst({
      where: {
        id: pedidoId,
        empresaId,
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const estadoAnterior = pedido.estado;
    const dataToUpdate: any = {
      estado: dto.estado,
    };

    if (dto.estado === 'CONFIRMADO' && !pedido.fechaConfirmacion) {
      dataToUpdate.fechaConfirmacion = new Date();
      dataToUpdate.usuarioConfirma = dto.usuarioConfirma;
    }

    // Actualizar pedido y registrar en historial en una transacción
    const [pedidoActualizado] = await this.prisma.$transaction([
      this.prisma.pedidoTienda.update({
        where: { id: pedidoId },
        data: dataToUpdate,
        include: {
          items: {
            include: {
              producto: {
                select: {
                  descripcion: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.historialEstadoPedido.create({
        data: {
          pedidoId,
          estadoAnterior,
          estadoNuevo: dto.estado,
          usuarioId: dto.usuarioConfirma,
          notas: `Estado cambiado de ${estadoAnterior} a ${dto.estado}`,
        },
      }),
    ]);

    return pedidoActualizado;
  }

  // Métodos nuevos para configuración de envío
  async obtenerConfiguracionEnvio(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        costoEnvioFijo: true,
        aceptaRecojo: true,
        aceptaEnvio: true,
        direccionRecojo: true,
        tiempoPreparacionMin: true,
      },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    return empresa;
  }

  async actualizarConfiguracionEnvio(empresaId: number, dto: any) {
    return this.prisma.empresa.update({
      where: { id: empresaId },
      data: dto,
      select: {
        costoEnvioFijo: true,
        aceptaRecojo: true,
        aceptaEnvio: true,
        direccionRecojo: true,
        tiempoPreparacionMin: true,
      },
    });
  }

  // ==================== COMBOS ====================

  async obtenerCombosTienda(slug: string) {
    const tienda = await this.obtenerTiendaPorSlug(slug);

    const combos = await this.prisma.combo.findMany({
      where: {
        empresaId: tienda.id,
        activo: true,
        OR: [
          { fechaInicio: null },
          { fechaInicio: { lte: new Date() } }
        ],
        AND: [
          {
            OR: [
              { fechaFin: null },
              { fechaFin: { gte: new Date() } }
            ]
          }
        ]
      },
      include: {
        items: {
          include: {
            producto: {
              select: {
                id: true,
                descripcion: true,
                imagenUrl: true,
                precioUnitario: true,
                stock: true,
                categoria: {
                  select: {
                    id: true,
                    nombre: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { creadoEn: 'desc' }
    });

    return { code: 1, data: combos };
  }

  async obtenerComboDetalle(slug: string, comboId: number) {
    const tienda = await this.obtenerTiendaPorSlug(slug);

    const combo = await this.prisma.combo.findFirst({
      where: {
        id: comboId,
        empresaId: tienda.id
      },
      include: {
        items: {
          include: {
            producto: {
              select: {
                id: true,
                descripcion: true,
                imagenUrl: true,
                precioUnitario: true,
                stock: true,
                categoria: {
                  select: {
                    id: true,
                    nombre: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!combo) {
      throw new NotFoundException('Combo no encontrado');
    }

    return { code: 1, data: combo };
  }

  async verificarStockCombo(slug: string, comboId: number) {
    const tienda = await this.obtenerTiendaPorSlug(slug);

    const combo = await this.prisma.combo.findFirst({
      where: {
        id: comboId,
        empresaId: tienda.id
      },
      include: {
        items: {
          include: { producto: true }
        }
      }
    });

    if (!combo) {
      throw new NotFoundException('Combo no encontrado');
    }

    // Calcular stock disponible
    const stockDisponible = combo.items.reduce((min, item) => {
      const stockProducto = Math.floor(item.producto.stock / item.cantidad);
      return Math.min(min, stockProducto);
    }, Infinity);

    return {
      code: 1,
      data: {
        comboId,
        stockDisponible: stockDisponible === Infinity ? 0 : stockDisponible
      }
    };
  }

  // ==================== PEDIDOS ====================

  async obtenerPedidoPorCodigo(codigoSeguimiento: string) {
    const pedido = await this.prisma.pedidoTienda.findUnique({
      where: { codigoSeguimiento },
      include: {
        items: {
          include: {
            producto: {
              select: {
                descripcion: true,
                imagenUrl: true,
              },
            },
          },
        },
        empresa: {
          select: {
            nombreComercial: true,
            razonSocial: true,
            whatsappTienda: true,
            direccionRecojo: true,
          },
        },
        historialEstados: {
          orderBy: { creadoEn: 'asc' },
          select: {
            estadoAnterior: true,
            estadoNuevo: true,
            creadoEn: true,
            notas: true,
          },
        },
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    // Firmar URLs de S3 para las imágenes de productos
    const pedidoConImagenesFirmadas = {
      ...pedido,
      items: await Promise.all(
        pedido.items.map(async (item) => ({
          ...item,
          producto: item.producto
            ? {
              ...item.producto,
              imagenUrl: item.producto.imagenUrl
                ? await this.signS3UrlIfNeeded(item.producto.imagenUrl)
                : null,
            }
            : null,
        }))
      ),
    };

    return pedidoConImagenesFirmadas;
  }

  private async signS3UrlIfNeeded(url: string | null): Promise<string | null> {
    if (!url) return null;
    try {
      const idx = url.indexOf('amazonaws.com/');
      if (idx === -1) return url; // No es URL de S3, devolver tal cual
      const key = url.substring(idx + 'amazonaws.com/'.length);
      if (!key) return url;
      return (await this.s3.getSignedGetUrl(key, 3600)) || url;
    } catch (error) {
      console.error('Error signing S3 URL:', error);
      return url; // Fallback a URL original
    }
  }

  async obtenerHistorialEstados(empresaId: number, pedidoId: number) {
    const pedido = await this.prisma.pedidoTienda.findFirst({
      where: {
        id: pedidoId,
        empresaId,
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return this.prisma.historialEstadoPedido.findMany({
      where: { pedidoId },
      orderBy: { creadoEn: 'asc' },
      include: {
        usuario: {
          select: {
            nombre: true,
          },
        },
      },
    });
  }
}
