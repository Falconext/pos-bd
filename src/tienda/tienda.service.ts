import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { EstadoProductoReview, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { ConfigurarTiendaDto } from './dto/configurar-tienda.dto';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { ActualizarEstadoPedidoDto } from './dto/actualizar-pedido.dto';
import { DisenoRubroService } from '../diseno-rubro/diseno-rubro.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { esRubroComputo, obtenerPlantillaComputo } from '../producto/ficha-tecnica-computo';

const ESTADOS_ENVIO_NOTIFICABLES = new Set(['EN_CAMINO', 'EN_REPARTO', 'ENVIADO', 'ENTREGADO']);

const MENSAJES_DEFAULT_TIENDA: Record<string, string> = {
  EN_CAMINO: 'Hola {{nombre}}, tu pedido {{pedido}} ya está en camino 🚚. Repartidor: {{repartidor}}.',
  ENTREGADO: 'Hola {{nombre}}, tu pedido {{pedido}} fue entregado exitosamente ✅. ¡Gracias por preferir {{empresa}}!',
};

const PEDIDO_ENTREGA_TO_DESPACHO: Record<string, string> = {
  PENDIENTE: 'PREPARANDO',
  CONFIRMADO: 'PREPARANDO',
  EN_TRANSITO: 'EN_CAMINO',
  REPROGRAMADO: 'PREPARANDO',
  ENTREGADO_COMPLETADO: 'ENTREGADO',
  CANCELADO_INTERNO: 'DEVUELTO',
  CANCELADO_CLIENTE: 'DEVUELTO',
};

const PEDIDO_ENVIO_TO_DESPACHO: Record<string, string> = {
  SIN_ASIGNAR: 'PREPARANDO',
  POR_COORDINAR: 'PREPARANDO',
  ENVIADO: 'EN_CAMINO',
  EN_REPARTO: 'EN_CAMINO',
  EN_CAMINO: 'EN_CAMINO',
  ENTREGADO: 'ENTREGADO',
  INCIDENCIA: 'DEVUELTO',
  NO_APLICA: 'PREPARANDO',
};

interface CulqiChargeResponse {
  id: string;
  amount: number;
  currency_code: string;
  email?: string;
  paid?: boolean;
  outcome?: {
    type?: string;
    code?: string;
    user_message?: string;
    merchant_message?: string;
  };
}

@Injectable()
export class TiendaService {
  private readonly logger = new Logger(TiendaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly disenoService: DisenoRubroService,
    private readonly whatsapp: WhatsAppService,
  ) { }

  private handlePedidoSchemaError(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2022'
    ) {
      throw new InternalServerErrorException(
        'Falta aplicar la migración ecommerce de pedidos. Ejecuta prisma migrate deploy y prisma generate en backend.',
      );
    }

    throw error;
  }

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
        // Logo
        logo: true,
        plan: {
          select: {
            tieneTienda: true,
            nombre: true,
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

    const diseno = await this.disenoService.obtenerDisenoPorEmpresa(empresaId);

    return {
      ...empresa,
      diseno: diseno || {},
      yapeQrSignedUrl: await signIfS3(empresa.yapeQrUrl as any),
      plinQrSignedUrl: await signIfS3(empresa.plinQrUrl as any),
      logoSignedUrl: await signIfS3(empresa.logo as any),
    } as any;
  }

  async actualizarDiseno(empresaId: number, campos: Record<string, any>) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { disenoOverride: true },
    });
    const overrideActual = empresa?.disenoOverride
      ? JSON.parse(empresa.disenoOverride as string)
      : {};
    const nuevoOverride = { ...overrideActual, ...campos };
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { disenoOverride: JSON.stringify(nuevoOverride) },
    });
    return { success: true };
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

  // ==================== UPLOAD LOGO ====================

  async subirLogo(
    empresaId: number,
    file: { buffer: Buffer; mimetype?: string },
  ) {
    if (!file || !file.buffer)
      throw new BadRequestException('Archivo no proporcionado');
    const ct = file.mimetype || 'image/jpeg';
    if (!/^image\//i.test(ct))
      throw new BadRequestException('El archivo debe ser una imagen');

    const ext = ct.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const s3Key = `logos/empresa-${empresaId}/logo-${Date.now()}.${ext}`;
    const url = await this.s3.uploadImage(file.buffer, s3Key, ct);

    await this.prisma.empresa.update({ where: { id: empresaId }, data: { logo: url } });

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
        AND: [this.whereStockPublico()],
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
        marcaId: { not: null },
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

      const hydratePublicProducts = async (itemsRaw: any[]) => {
        const productIds = itemsRaw.map((item) => item.id);
        const ratings = productIds.length
          ? await this.prisma.productoReview.groupBy({
              by: ['productoId'],
              where: {
                empresaId: empresa.id,
                productoId: { in: productIds },
                estado: EstadoProductoReview.APROBADO,
              },
              _avg: { rating: true },
              _count: { rating: true },
            })
          : [];
        const ratingByProduct = new Map(
          ratings.map((item) => [
            item.productoId,
            {
              ratingAvg: item._avg.rating ? Number(item._avg.rating.toFixed(2)) : 0,
              ratingCount: item._count.rating || 0,
            },
          ]),
        );

        return Promise.all(
          itemsRaw.map(async (product: any) => ({
            ...product,
            ...(ratingByProduct.get(product.id) || { ratingAvg: 0, ratingCount: 0 }),
            imagenUrl: await signIfS3(product.imagenUrl),
            imagenesExtra: Array.isArray(product.imagenesExtra)
              ? await Promise.all(product.imagenesExtra.map((url: string) => signIfS3(url)))
              : product.imagenesExtra,
          })),
        );
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
        atributosTecnicos: true,
        categoria: { select: { id: true, nombre: true } },
        unidadMedida: { select: { codigo: true, nombre: true } },
        marca: { select: { id: true, nombre: true } },
      } as const;

      const baseOrder = [{ destacado: 'desc' as const }, { descripcion: 'asc' as const }];

      const wherePublicados: any = {
        empresaId: empresa.id,
        publicarEnTienda: true,
        estado: 'ACTIVO' as const,
        productoPadreId: null,
        AND: [this.whereStockPublico()],
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

      const countPublicados = await this.prisma.producto.count({ where: wherePublicados });
      const hasCatalogFilters =
        !!term ||
        !!category?.trim() ||
        !!brand?.trim() ||
        minPrice !== undefined ||
        maxPrice !== undefined ||
        wholesale;
      const pageNumber = Number(page) || 1;
      
      let shouldFallbackToActivos = false;
      if (countPublicados === 0) {
        if (hasCatalogFilters) {
          const countTotalPublicados = await this.prisma.producto.count({
            where: {
              empresaId: empresa.id,
              publicarEnTienda: true,
              estado: 'ACTIVO',
              productoPadreId: null,
              AND: [this.whereStockPublico()],
            }
          });
          shouldFallbackToActivos = countTotalPublicados === 0;
        } else {
          shouldFallbackToActivos = true;
        }
      }

      if (!shouldFallbackToActivos) {
        let itemsRaw: any[] = [];
        if (countPublicados > 0) {
          itemsRaw = await this.prisma.producto.findMany({
            where: wherePublicados,
            select,
            orderBy: baseOrder,
            skip,
            take,
          });
        }
        const items = await hydratePublicProducts(itemsRaw);
        return { data: items, total: countPublicados, page: pageNumber, limit: take };
      }

      // Fallback: activos con stock>0
      // - Cuando no hay publicados
      // - O cuando en Home hay muy pocos publicados (evita secciones vacías en producción)
      const whereActivos: any = {
        empresaId: empresa.id,
        estado: 'ACTIVO' as const,
        productoPadreId: null,
        AND: [this.whereStockPublico()],
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

      const items = await hydratePublicProducts(itemsRaw);

      return { data: items, total, page: pageNumber, limit: take };

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
          AND: [this.whereStockPublico()],
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
          AND: [this.whereStockPublico()],
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
      select: { id: true, rubroId: true, rubro: { select: { nombre: true } } },
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
      atributosTecnicos: true,
      categoria: {
        select: {
          id: true,
          nombre: true,
        },
      },
      marca: {
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
      opcionesAtributos: true,
      variantes: {
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          precioUnitario: true,
          stock: true,
          valoresAtributos: true,
          imagenUrl: true,
        }
      }
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
    // SOLO si la tienda NO tiene ningún producto marcado como publicarEnTienda=true.
    if (!producto) {
      const countTotalPublicados = await this.prisma.producto.count({
        where: {
          empresaId: empresa.id,
          publicarEnTienda: true,
          estado: 'ACTIVO',
          productoPadreId: null,
          AND: [this.whereStockPublico()],
        }
      });
      if (countTotalPublicados === 0) {
        producto = await this.prisma.producto.findFirst({
          where: {
            id: productoId,
            empresaId: empresa.id,
            estado: 'ACTIVO',
            AND: [this.whereStockPublico()],
          },
          select,
        });
      }
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
      fichaTecnica: await this.construirFichaTecnicaPublica(empresa, producto as any),
    } as any;
  }

  private getFichaTecnicaComputoDefault(params: { categoriaNombre?: string | null; descripcion?: string | null } = {}) {
    return obtenerPlantillaComputo(params);
  }

  private esRubroComputo(nombre?: string | null) {
    return esRubroComputo(nombre);
  }

  private whereStockPublico() {
    return { stock: { gte: 0 } };
  }

  private formatearValorFichaTecnica(value: any, campo: any) {
    if (value === null || value === undefined || value === '') return '';
    if (campo?.tipo === 'booleano') {
      return value === true || value === 'true' || value === '1' || value === 'Sí' ? 'Sí' : 'No';
    }
    const formatted = String(value).trim();
    return campo?.unidad && formatted ? `${formatted} ${campo.unidad}` : formatted;
  }

  private async construirFichaTecnicaPublica(empresa: any, producto: any) {
    const atributos = {
      ...(producto?.atributosTecnicos || {}),
      ...(producto?.marca?.nombre ? { marca: producto.marca.nombre } : {}),
    };
    if (!atributos || Object.keys(atributos).length === 0) return null;

    const candidates = await this.prisma.fichaTecnicaPlantilla.findMany({
      where: {
        activo: true,
        OR: [
          { empresaId: empresa.id, categoriaId: producto.categoria?.id || undefined },
          { empresaId: empresa.id, categoriaId: null },
          { empresaId: null, categoriaId: producto.categoria?.id || undefined },
          { empresaId: null, rubroId: empresa.rubroId || undefined },
        ],
      },
      orderBy: [{ empresaId: 'desc' }, { categoriaId: 'desc' }, { rubroId: 'desc' }, { id: 'asc' }],
      take: 10,
    });
    const exactCategory = candidates.find((item) => producto.categoria?.id && item.categoriaId === producto.categoria.id);
    const companyDefault = candidates.find((item) => item.empresaId === empresa.id && !item.categoriaId);
    const rubroDefault = candidates.find((item) => item.rubroId === empresa.rubroId);
    const computedDefault = this.esRubroComputo(empresa.rubro?.nombre)
      ? this.getFichaTecnicaComputoDefault({
          categoriaNombre: producto.categoria?.nombre,
          descripcion: producto.descripcion,
        })
      : null;
    const shouldPreferComputed = computedDefault && (computedDefault as any).familia !== 'general';
    const plantilla = exactCategory || companyDefault || (shouldPreferComputed ? computedDefault : rubroDefault) || candidates[0] || computedDefault;

    if (!plantilla) return null;

    const campos = Array.isArray((plantilla as any).campos) ? (plantilla as any).campos : [];
    const destacadosKeys = Array.isArray((plantilla as any).destacados) ? (plantilla as any).destacados : [];
    const valuesByKey = new Map<string, any>();

    const gruposMap = new Map<string, any[]>();
    for (const campo of campos.sort((a: any, b: any) => Number(a.orden || 0) - Number(b.orden || 0))) {
      const rawValue = atributos[campo.key];
      const value = this.formatearValorFichaTecnica(rawValue, campo);
      if (!value) continue;
      valuesByKey.set(campo.key, value);
      const grupo = campo.grupo || 'Características';
      const current = gruposMap.get(grupo) || [];
      current.push({ key: campo.key, label: campo.label, value });
      gruposMap.set(grupo, current);
    }

    const destacados = destacadosKeys
      .map((key: string) => {
        const campo = campos.find((item: any) => item.key === key);
        const value = valuesByKey.get(key);
        return campo && value ? { key, label: campo.label, value } : null;
      })
      .filter(Boolean);

    const grupos = Array.from(gruposMap.entries()).map(([nombre, items]) => ({ nombre, items }));
    if (!destacados.length && !grupos.length) return null;
    return { destacados, grupos };
  }

  private async recalcularRatingProducto(productoId: number) {
    const aggregate = await this.prisma.productoReview.aggregate({
      where: { productoId, estado: EstadoProductoReview.APROBADO },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.producto.update({
      where: { id: productoId },
      data: {
        ratingAvg: aggregate._avg.rating
          ? Number(aggregate._avg.rating.toFixed(2))
          : 0,
        ratingCount: aggregate._count.rating || 0,
      },
    });
  }

  async listarReviewsPublicas(slug: string, productoId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });
    if (!empresa) throw new NotFoundException('Tienda no encontrada');

    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId: empresa.id, estado: 'ACTIVO' },
      select: { id: true, ratingAvg: true, ratingCount: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const reviews = await this.prisma.productoReview.findMany({
      where: {
        empresaId: empresa.id,
        productoId,
        estado: EstadoProductoReview.APROBADO,
      },
      orderBy: { creadoEn: 'desc' },
      take: 20,
      select: {
        id: true,
        clienteNombre: true,
        rating: true,
        comentario: true,
        compraVerificada: true,
        creadoEn: true,
      },
    });

    const rating = await this.prisma.productoReview.aggregate({
      where: {
        empresaId: empresa.id,
        productoId,
        estado: EstadoProductoReview.APROBADO,
      },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return {
      ratingAvg: rating._avg.rating ? Number(rating._avg.rating.toFixed(2)) : 0,
      ratingCount: rating._count.rating || 0,
      reviews,
    };
  }

  async crearReviewPublica(slug: string, productoId: number, dto: any) {
    const rating = Number(dto?.rating);
    const comentario = String(dto?.comentario || '').trim();
    const clienteNombre = String(dto?.clienteNombre || '').trim();
    const clienteEmail = String(dto?.clienteEmail || '').trim() || null;
    const clienteTelefono = String(dto?.clienteTelefono || '').replace(/\s+/g, '').trim() || null;
    const codigoSeguimiento = String(dto?.codigoSeguimiento || '').trim() || null;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('La calificación debe ser de 1 a 5');
    }
    if (clienteNombre.length < 2) {
      throw new BadRequestException('Ingresa tu nombre');
    }
    if (comentario.length < 8 || comentario.length > 800) {
      throw new BadRequestException('El comentario debe tener entre 8 y 800 caracteres');
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });
    if (!empresa) throw new NotFoundException('Tienda no encontrada');

    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId: empresa.id, estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    let pedido: { id: number } | null = null;
    if (codigoSeguimiento) {
      const identidadCliente = [
        clienteTelefono ? { clienteTelefono } : null,
        clienteEmail ? { clienteEmail } : null,
      ].filter(Boolean);
      pedido = await this.prisma.pedidoTienda.findFirst({
        where: {
          empresaId: empresa.id,
          codigoSeguimiento,
          items: { some: { productoId } },
          ...(identidadCliente.length > 0 ? { OR: identidadCliente as any } : {}),
        },
        select: { id: true },
      });
    }

    const review = await this.prisma.productoReview.create({
      data: {
        empresaId: empresa.id,
        productoId,
        pedidoId: pedido?.id,
        clienteNombre,
        clienteEmail,
        clienteTelefono,
        rating,
        comentario,
        compraVerificada: Boolean(pedido),
        estado: EstadoProductoReview.PENDIENTE,
      },
      select: {
        id: true,
        estado: true,
        compraVerificada: true,
      },
    });

    return {
      ...review,
      message: 'Gracias por tu reseña. Será publicada cuando la tienda la apruebe.',
    };
  }

  async listarReviewsAdmin(empresaId: number, estado?: string, page = 1, limit = 50) {
    const where: any = { empresaId };
    if (estado && Object.values(EstadoProductoReview).includes(estado as EstadoProductoReview)) {
      where.estado = estado;
    }

    const take = Math.max(1, Math.min(Number(limit) || 50, 100));
    const skip = Math.max(0, (Number(page) || 1) - 1) * take;

    const [items, total] = await Promise.all([
      this.prisma.productoReview.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip,
        take,
        include: {
          producto: { select: { id: true, descripcion: true, imagenUrl: true } },
          pedido: { select: { id: true, codigoSeguimiento: true } },
        },
      }),
      this.prisma.productoReview.count({ where }),
    ]);

    return { items, total, page: Number(page) || 1, limit: take };
  }

  async actualizarEstadoReviewAdmin(
    empresaId: number,
    reviewId: number,
    estado: EstadoProductoReview,
  ) {
    if (!Object.values(EstadoProductoReview).includes(estado)) {
      throw new BadRequestException('Estado de reseña inválido');
    }

    const review = await this.prisma.productoReview.findFirst({
      where: { id: reviewId, empresaId },
      select: { id: true, productoId: true },
    });
    if (!review) throw new NotFoundException('Reseña no encontrada');

    const updated = await this.prisma.productoReview.update({
      where: { id: reviewId },
      data: {
        estado,
        aprobadoEn: estado === EstadoProductoReview.APROBADO ? new Date() : null,
      },
    });

    await this.recalcularRatingProducto(review.productoId);
    return updated;
  }

  async obtenerConfiguracionPago(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: {
        id: true,
        yapeQrUrl: true,
        yapeNumero: true,
        plinQrUrl: true,
        plinNumero: true,
        aceptaEfectivo: true,
        whatsappTienda: true,
        plan: {
          select: {
            tieneCulqi: true,
          },
        },
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

    const culqiPublicKey = (process.env.CULQI_PUBLIC_KEY || '').trim();
    const culqiSecretKey = (process.env.CULQI_SECRET_KEY || '').trim();
    const aceptaTarjeta = Boolean(empresa.plan?.tieneCulqi && culqiPublicKey);

    return {
      yapeQrUrl: await signIfS3(empresa.yapeQrUrl),
      yapeNumero: empresa.yapeNumero,
      plinQrUrl: await signIfS3(empresa.plinQrUrl),
      plinNumero: empresa.plinNumero,
      aceptaEfectivo: empresa.aceptaEfectivo,
      whatsappTienda: empresa.whatsappTienda,
      aceptaTarjeta,
      culqiPublicKey: aceptaTarjeta ? culqiPublicKey : null,
      culqiBackendReady: Boolean(culqiSecretKey),
    };
  }

  async obtenerConfiguracionEnvioPublica(slug: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: {
        costoEnvioFijo: true,
        envioGratisDesdeSoles: true,
        minimoCompra: true,
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
        minimoCompra: true,
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
            AND: [this.whereStockPublico()],
          },
        });
      }

      if (!producto) {
        throw new BadRequestException(
          `Producto con ID ${item.productoId} no disponible o sin stock`,
        );
      }

      const esServicio = String((producto.atributosTecnicos as any)?.tipoProducto || '').toUpperCase() === 'SERVICIO';
      if (!esServicio && producto.stock < item.cantidad) {
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
    const adelanto = dto.medioPago === 'TARJETA' ? total : Math.max(Number(dto.adelanto ?? 0), 0);
    const montoPagado = Math.min(adelanto, total);
    const saldoPendiente = Math.max(total - montoPagado, 0);
    const estadoEnvioInicial = tipoEntrega === 'ENVIO' ? 'POR_COORDINAR' : 'NO_APLICA';
    const agenciaEnvioInicial =
      tipoEntrega === 'ENVIO'
        ? dto.agenciaEnvio?.trim() || null
        : 'RECOJO EN TIENDA';

    // Validar monto mínimo de pedido (se evalúa después de calcular el total real)
    const minimoCompra = Number(empresa.minimoCompra || 0);
    if (minimoCompra > 0 && total < minimoCompra) {
      throw new BadRequestException(`El monto mínimo de pedido es S/ ${minimoCompra.toFixed(2)}`);
    }

    // Generar un código de seguimiento único y corto
    const codigoSeguimiento = `PT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

    let referenciaTarjeta: string | null = null;
    if (dto.medioPago === 'TARJETA') {
      if (!empresa.id) {
        throw new BadRequestException('No se pudo identificar la empresa para cobro con tarjeta');
      }
      const culqiToken = (dto.culqiToken || '').trim();
      if (!culqiToken) {
        throw new BadRequestException('Falta el token de pago con tarjeta');
      }

      const empresaConPlan = await this.prisma.empresa.findUnique({
        where: { id: empresa.id },
        select: {
          nombreComercial: true,
          razonSocial: true,
          plan: { select: { tieneCulqi: true } },
        },
      });

      if (!empresaConPlan?.plan?.tieneCulqi) {
        throw new ForbiddenException('Tu plan actual no incluye pagos con tarjeta');
      }

      const emailPago = (dto.culqiEmail || dto.clienteEmail || '').trim();
      if (!emailPago) {
        throw new BadRequestException('Para pagar con tarjeta debes registrar un correo electrónico');
      }

      const charge = await this.crearCargoCulqi({
        token: culqiToken,
        email: emailPago,
        amountInSoles: total,
        empresaNombre: empresaConPlan.nombreComercial || empresaConPlan.razonSocial || 'Tienda',
        orderCode: codigoSeguimiento,
      });

      referenciaTarjeta = `culqi_charge:${charge.id}`;
    }

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
        montoPagado,
        saldoPendiente,
        estadoEntrega: 'PENDIENTE',
        estadoEnvio: estadoEnvioInicial,
        agenciaEnvio: agenciaEnvioInicial,
        vendedorNombre: 'Tienda online',
        observaciones: dto.observaciones,
        referenciaTransf: referenciaTarjeta || dto.referenciaTransf,
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

  private validarMontoCulqiEnCentavos(montoSoles: number): number {
    if (!Number.isFinite(montoSoles) || montoSoles <= 0) {
      throw new BadRequestException('Monto inválido para cobro con tarjeta');
    }
    return Math.round(montoSoles * 100);
  }

  private async crearCargoCulqi(params: {
    token: string;
    email: string;
    amountInSoles: number;
    empresaNombre: string;
    orderCode: string;
  }): Promise<CulqiChargeResponse> {
    const secretKey = (process.env.CULQI_SECRET_KEY || '').trim();
    if (!secretKey) {
      throw new BadRequestException('Pasarela de tarjeta no configurada');
    }

    const payload = {
      amount: this.validarMontoCulqiEnCentavos(params.amountInSoles),
      currency_code: 'PEN',
      email: params.email,
      source_id: params.token,
      description: `Pedido tienda ${params.empresaNombre} - ${params.orderCode}`,
      metadata: {
        orderCode: params.orderCode,
        empresa: params.empresaNombre,
      },
    };

    try {
      const { data } = await axios.post<CulqiChargeResponse>(
        'https://api.culqi.com/v2/charges',
        payload,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      );

      if (!data?.id) {
        throw new BadRequestException('No se pudo confirmar el cobro con tarjeta');
      }

      const estadoPagoValido =
        data.paid === true ||
        data.outcome?.type === 'venta_exitosa' ||
        data.outcome?.type === 'venta_autorizada';

      if (!estadoPagoValido) {
        throw new BadRequestException(
          data.outcome?.user_message ||
          data.outcome?.merchant_message ||
          'El pago con tarjeta no fue aprobado por Culqi',
        );
      }

      return data;
    } catch (error: unknown) {
      let messageFromCulqi: string | null = null;

      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data as
          | { user_message?: string; merchant_message?: string; message?: string }
          | undefined;
        messageFromCulqi =
          errorData?.user_message ||
          errorData?.merchant_message ||
          errorData?.message ||
          null;
      }

      throw new BadRequestException(
        messageFromCulqi || 'No se pudo procesar el pago con tarjeta',
      );
    }
  }

  async listarPedidos(empresaId: number, estado?: string, page = 1, limit = 50) {
    const where: any = { empresaId };

    if (estado) {
      where.estado = estado;
    }

    // Pagination
    const skip = Math.max(0, (Number(page) || 1) - 1) * (Number(limit) || 50);
    const take = Math.max(1, Math.min(100, Number(limit) || 50)); // Max 100 per request

    try {
      // Get total count for pagination info
      const total = await this.prisma.pedidoTienda.count({ where });

      const data = await this.prisma.pedidoTienda.findMany({
        where,
        include: {
          items: {
            include: {
              producto: {
                select: {
                  codigo: true,
                  descripcion: true,
                  imagenUrl: true,
                  atributosTecnicos: true,
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
    } catch (error) {
      this.handlePedidoSchemaError(error);
    }
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
                atributosTecnicos: true,
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
    const estadoNuevo = dto.estado || pedido.estado;
    const dataToUpdate: any = {};

    if (dto.estado) dataToUpdate.estado = dto.estado;
    if (dto.estadoEntrega !== undefined) dataToUpdate.estadoEntrega = dto.estadoEntrega;
    if (dto.agenciaEnvio !== undefined) dataToUpdate.agenciaEnvio = dto.agenciaEnvio;
    if (dto.estadoEnvio !== undefined) dataToUpdate.estadoEnvio = dto.estadoEnvio;
    if (dto.numeroTracking !== undefined) dataToUpdate.numeroTracking = dto.numeroTracking;
    if (dto.repartidorId !== undefined) dataToUpdate.repartidorId = dto.repartidorId || null;
    if (dto.clienteDireccion !== undefined) dataToUpdate.clienteDireccion = dto.clienteDireccion;
    if (dto.clienteTelefono !== undefined) dataToUpdate.clienteTelefono = dto.clienteTelefono;
    if (dto.notasInternas !== undefined) dataToUpdate.notasInternas = dto.notasInternas;
    if (dto.usuarioConfirma !== undefined) dataToUpdate.vendedorId = dto.usuarioConfirma;
    if (dto.vendedorNombre !== undefined) dataToUpdate.vendedorNombre = dto.vendedorNombre;
    const pagoCompletoConfirmado = dto.montoPagado !== undefined &&
      Number(pedido.saldoPendiente) > 0.01 &&
      Number(dto.montoPagado) >= Number(pedido.total);

    if (dto.montoPagado !== undefined) {
      const montoPagado = Math.min(Math.max(Number(dto.montoPagado) || 0, 0), Number(pedido.total));
      dataToUpdate.montoPagado = montoPagado;
      dataToUpdate.saldoPendiente = Math.max(Number(pedido.total) - montoPagado, 0);
    }

    if (dto.estado === 'CONFIRMADO' && !pedido.fechaConfirmacion) {
      dataToUpdate.fechaConfirmacion = new Date();
      dataToUpdate.usuarioConfirma = dto.usuarioConfirma;
    }

    const notas = [
      dto.estado ? `Estado comercial: ${estadoAnterior} -> ${dto.estado}` : null,
      dto.estadoEntrega ? `Entrega: ${dto.estadoEntrega}` : null,
      dto.estadoEnvio ? `Envío: ${dto.estadoEnvio}` : null,
      dto.agenciaEnvio ? `Agencia: ${dto.agenciaEnvio}` : null,
      dto.repartidorId !== undefined ? `Repartidor ID: ${dto.repartidorId || 'Sin asignar'}` : null,
      dto.numeroTracking ? `Tracking: ${dto.numeroTracking}` : null,
      dto.montoPagado !== undefined ? `Pagado: S/ ${Number(dto.montoPagado).toFixed(2)}` : null,
    ].filter(Boolean).join(' · ') || 'Pedido actualizado';

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
                  codigo: true,
                  descripcion: true,
                  imagenUrl: true,
                },
              },
            },
          },
          repartidor: {
            select: {
              id: true,
              nombre: true,
              celular: true,
            },
          },
        },
      }),
      this.prisma.historialEstadoPedido.create({
        data: {
          pedidoId,
          estadoAnterior,
          estadoNuevo,
          usuarioId: dto.usuarioConfirma,
          notas,
        },
      }),
    ]);

    const estadoEnvioCambia = dto.estadoEnvio && dto.estadoEnvio !== pedido.estadoEnvio;
    if (estadoEnvioCambia && dto.estadoEnvio && ESTADOS_ENVIO_NOTIFICABLES.has(dto.estadoEnvio)) {
      this.notificarCambioEstadoEnvio(
        pedido.empresaId,
        dto.estadoEnvio,
        pedido.clienteTelefono,
        pedido.clienteNombre,
        pedido.codigoSeguimiento,
        (pedidoActualizado as any).repartidor?.nombre ?? null,
      ).catch((e) => this.logger.warn(`WA tienda fallido: ${e.message}`));
    }

    // WA: paquete en agencia (pendiente de pago)
    const llegoAAgencia = dto.estadoEntrega === 'EN_AGENCIA' && pedido.estadoEntrega !== 'EN_AGENCIA';
    if (llegoAAgencia && pedido.clienteTelefono) {
      this.notificarEnAgencia(
        pedido.empresaId,
        pedido.clienteTelefono,
        pedido.clienteNombre,
        pedido.codigoSeguimiento,
        Number(pedido.saldoPendiente),
        pedido.agenciaEnvio ?? null,
      ).catch((e) => this.logger.warn(`WA agencia fallido: ${e.message}`));
    }

    // WA: pago completo confirmado
    if (pagoCompletoConfirmado && pedido.clienteTelefono) {
      this.notificarPagoCompleto(
        pedido.empresaId,
        pedido.clienteTelefono,
        pedido.clienteNombre,
        pedido.codigoSeguimiento,
      ).catch((e) => this.logger.warn(`WA pago completo fallido: ${e.message}`));
    }

    await this.syncDespachoByPedido(pedidoActualizado as any, dto);

    return pedidoActualizado;
  }

  private async syncDespachoByPedido(pedido: { comprobanteId?: number | null }, dto: ActualizarEstadoPedidoDto) {
    if (!pedido.comprobanteId) return;
    const estadoDespacho = dto.estadoEnvio
      ? PEDIDO_ENVIO_TO_DESPACHO[dto.estadoEnvio]
      : dto.estadoEntrega
        ? PEDIDO_ENTREGA_TO_DESPACHO[dto.estadoEntrega]
        : null;
    if (!estadoDespacho) return;

    const envio = await this.prisma.envioDespacho.findUnique({
      where: { comprobanteId: pedido.comprobanteId },
      select: { estado: true, historial: true },
    });
    if (!envio || envio.estado === estadoDespacho) return;

    const historial = Array.isArray(envio.historial) ? envio.historial as any[] : [];
    await this.prisma.envioDespacho.update({
      where: { comprobanteId: pedido.comprobanteId },
      data: {
        estado: estadoDespacho as any,
        historial: [
          ...historial,
          {
            estado: estadoDespacho,
            fecha: new Date().toISOString(),
            nota: 'Sincronizado desde pedido tienda',
          },
        ],
      },
    });
  }

  private async notificarCambioEstadoEnvio(
    empresaId: number,
    estadoEnvio: string,
    telefono: string,
    clienteNombre: string,
    pedidoRef: string,
    repartidorNombre: string | null,
  ): Promise<void> {
    if (!telefono) return;

    const [empresa, config] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { razonSocial: true } }),
      this.prisma.despachoMensajeTemplate.findUnique({ where: { empresaId } }),
    ]);

    const esEnCamino = ['EN_CAMINO', 'EN_REPARTO', 'ENVIADO'].includes(estadoEnvio);
    const habilitado = esEnCamino
      ? (config?.notificarEnCamino ?? true)
      : (config?.notificarEntregado ?? true);
    if (!habilitado) return;

    const plantilla = esEnCamino
      ? (config?.mensajeEnCamino ?? MENSAJES_DEFAULT_TIENDA.EN_CAMINO)
      : (config?.mensajeEntregado ?? MENSAJES_DEFAULT_TIENDA.ENTREGADO);

    const mensaje = plantilla
      .replace(/\{\{nombre\}\}/g, clienteNombre ?? 'Cliente')
      .replace(/\{\{pedido\}\}/g, pedidoRef)
      .replace(/\{\{repartidor\}\}/g, repartidorNombre ?? 'Sin asignar')
      .replace(/\{\{empresa\}\}/g, empresa?.razonSocial ?? '');

    await this.whatsapp.enviarTexto(telefono, mensaje);
  }

  private async notificarEnAgencia(
    empresaId: number,
    telefono: string,
    clienteNombre: string,
    pedidoRef: string,
    saldo: number,
    agencia: string | null,
  ): Promise<void> {
    if (!telefono) return;
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { razonSocial: true } });
    const nombreAgencia = agencia && agencia !== 'RECOJO EN TIENDA' ? agencia : 'la agencia';
    const msg = `Hola ${clienteNombre}! 📦 Tu pedido ${pedidoRef} llegó a ${nombreAgencia}. Para que puedas retirarlo necesitamos confirmar el pago restante de S/ ${saldo.toFixed(2)}. Una vez confirmado te avisamos. — ${empresa?.razonSocial ?? ''}`;
    await this.whatsapp.enviarTexto(telefono, msg);
  }

  private async notificarPagoCompleto(
    empresaId: number,
    telefono: string,
    clienteNombre: string,
    pedidoRef: string,
  ): Promise<void> {
    if (!telefono) return;
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { razonSocial: true } });
    const msg = `Hola ${clienteNombre}! ✅ Tu pago fue confirmado. Ya puedes retirar tu pedido ${pedidoRef} de la agencia. ¡Gracias por tu compra! — ${empresa?.razonSocial ?? ''}`;
    await this.whatsapp.enviarTexto(telefono, msg);
  }

  // Métodos nuevos para configuración de envío
  async obtenerConfiguracionEnvio(empresaId: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        costoEnvioFijo: true,
        envioGratisDesdeSoles: true,
        minimoCompra: true,
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
        envioGratisDesdeSoles: true,
        minimoCompra: true,
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
