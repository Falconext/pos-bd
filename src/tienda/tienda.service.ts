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
        // Campos de envío/recojo
        costoEnvioFijo: true,
        aceptaRecojo: true,
        aceptaEnvio: true,
        direccionRecojo: true,
        tiempoPreparacionMin: true,
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
      },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

    if (!empresa.plan.tieneTienda) {
      throw new ForbiddenException('Esta tienda no está disponible');
    }

    const diseno = await this.disenoService.obtenerDisenoPorEmpresa(empresa.id);

    return {
      ...empresa,
      diseno,
    };
  }

  async obtenerProductosTienda(slug: string, page = 1, limit = 30, search = '') {
    const empresa = await this.prisma.empresa.findUnique({
      where: { slugTienda: slug },
      select: { id: true },
    });

    if (!empresa) {
      throw new NotFoundException('Tienda no encontrada');
    }

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

    const countPublicados = await this.prisma.producto.count({ where: wherePublicados });

    if (countPublicados > 0) {
      const itemsRaw = await this.prisma.producto.findMany({
        where: wherePublicados,
        select,
        orderBy: baseOrder,
        skip,
        take,
      });
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
    const total = await this.prisma.producto.count({ where: whereActivos });
    const itemsRaw = await this.prisma.producto.findMany({
      where: whereActivos,
      select,
      orderBy: baseOrder,
      skip,
      take,
    });
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

    const igv = subtotal * 0.18;
    const total = subtotal + igv + costoEnvio;

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

  async listarPedidos(empresaId: number, estado?: string) {
    const where: any = { empresaId };

    if (estado) {
      where.estado = estado;
    }

    return this.prisma.pedidoTienda.findMany({
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
    });
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

    return pedido;
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
