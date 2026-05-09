import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import bcrypt from 'bcrypt';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import { SedeService } from '../sede/sede.service';
import axios from 'axios';

function parseDDMMYYYY(input: string): Date {
  if (!input || input.trim() === '') {
    throw new ForbiddenException('Fecha no puede estar vacía');
  }

  // Detectar formato ISO (yyyy-MM-dd) vs formato dd/MM/yyyy
  if (input.includes('-')) {
    // Formato ISO: yyyy-MM-dd
    const [yyyy, mm, dd] = input.split('-').map((s) => parseInt(s, 10));
    if (!dd || !mm || !yyyy || isNaN(dd) || isNaN(mm) || isNaN(yyyy)) {
      throw new ForbiddenException(`Fecha inválida: ${input}`);
    }
    return new Date(Date.UTC(yyyy, mm - 1, dd));
  } else {
    // Formato dd/MM/yyyy
    const [dd, mm, yyyy] = input.split('/').map((s) => parseInt(s, 10));
    if (!dd || !mm || !yyyy || isNaN(dd) || isNaN(mm) || isNaN(yyyy)) {
      throw new ForbiddenException(`Fecha inválida: ${input}`);
    }
    return new Date(Date.UTC(yyyy, mm - 1, dd));
  }
}

@Injectable()
export class EmpresaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sedeService: SedeService,
  ) { }

  async crear(data: CreateEmpresaDto, adminSistemaNegocio?: string | null, adminUserId?: number) {
    const fechaActivacion = parseDDMMYYYY(data.fechaActivacion);
    const tipoEmpresa = data.tipoEmpresa || 'FORMAL';
    const esPrueba = data.esPrueba || false;

    const exist = await this.prisma.empresa.findUnique({
      where: { ruc: data.ruc },
    });
    if (exist) throw new ForbiddenException('Empresa ya registrada');

    const hashed = await bcrypt.hash(data.usuario.password, 10);

    // Asignar plan automáticamente
    let planId = data.planId || 0;
    if (!planId || planId === 0) {
      // Si es versión de prueba, buscar plan de prueba
      if (esPrueba) {
        const planPrueba = await this.prisma.plan.findFirst({
          where: { esPrueba: true },
        });
        if (planPrueba) {
          planId = planPrueba.id;
        } else {
          throw new ForbiddenException(
            'No hay plan de prueba disponible en el sistema',
          );
        }
      } else {
        // Buscar plan según tipo de empresa
        const plan = await this.prisma.plan.findFirst({
          where: {
            nombre: tipoEmpresa === 'INFORMAL' ? 'Mi Básico Informal' : 'Básico Formal',
            esPrueba: false,
          },
        });
        if (plan) {
          planId = plan.id;
        } else {
          // Si no existe plan específico, usar el primer plan no-prueba disponible
          const firstPlan = await this.prisma.plan.findFirst({
            where: { esPrueba: false },
          });
          if (!firstPlan) {
            throw new ForbiddenException(
              'No hay planes disponibles en el sistema',
            );
          }
          planId = firstPlan.id;
        }
      }
    }

    // Obtener duración del plan seleccionado
    const planSeleccionado = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!planSeleccionado) {
      throw new ForbiddenException('Plan seleccionado no encontrado');
    }

    // Calcular fecha de expiración usando duración del plan
    const ahora = new Date();
    const diasExpiracion = planSeleccionado.duracionDias || 30;
    let expiracion: Date;

    if (data.fechaExpiracion) {
      // Si viene fechaExpiracion del frontend, usarla
      expiracion = parseDDMMYYYY(data.fechaExpiracion);
    } else {
      // Si no, calcularla automáticamente
      expiracion = new Date(
        ahora.getTime() + diasExpiracion * 24 * 60 * 60 * 1000,
      );
    }

    // Obtener la primera unidad de medida disponible
    const unidadMedida = await this.prisma.unidadMedida.findFirst();
    if (!unidadMedida) {
      throw new ForbiddenException('No hay unidades de medida disponibles en el sistema');
    }

    const empresa = await this.prisma.empresa.create({
      data: {
        ruc: data.ruc,
        razonSocial: data.razonSocial,
        direccion: data.direccion,
        logo: data.logo || '',
        planId,
        tipoEmpresa,
        fechaActivacion,
        departamento: data.departamento,
        rubroId: data.rubroId,
        nombreComercial: data.nombreComercial,
        provincia: data.provincia,
        distrito: data.distrito,
        ubigeo: data.ubigeo,
        fechaExpiracion: expiracion,
        estado: 'ACTIVO',
        providerToken: data.providerToken || null,
        providerId: data.providerId || null,
        esAgenteRetencion: data.esAgenteRetencion || false,
        usaCodigoBarrasManual: data.usaCodigoBarrasManual,
        brand: adminSistemaNegocio
          ? adminSistemaNegocio.toLowerCase()
          : (data.brand || 'falconext'),
        usuarioPse: data.usuarioPse || null,
        contrasenaPse: data.contrasenaPse || null,
        usuarios: {
          create: {
            nombre: data.usuario.nombre,
            email: data.usuario.email,
            password: hashed,
            dni: data.usuario.dni,
            celular: data.usuario.celular,
            rol: 'ADMIN_EMPRESA',
            estado: 'ACTIVO',
          },
        },
        clientes: {
          create: {
            nombre: 'CLIENTES VARIOS',
            nroDoc: '10000000',
            estado: 'ACTIVO',
            tipoDocumento: { connect: { codigo: '1' } }, // DNI
          },
        },
        productos: {
          create: [
            {
              codigo: 'DGD',
              descripcion: 'Descuento global',
              unidadMedidaId: unidadMedida.id,
              precioUnitario: 0,
              valorUnitario: 0,
              igvPorcentaje: 0,
              stock: 0,
              tipoAfectacionIGV: '10',
              estado: 'INACTIVO',
            },
            {
              codigo: 'IPM',
              descripcion: 'Interes por mora',
              unidadMedidaId: unidadMedida.id,
              precioUnitario: 0,
              valorUnitario: 0,
              igvPorcentaje: 0,
              stock: 0,
              tipoAfectacionIGV: '10',
              estado: 'INACTIVO',
            },
            {
              codigo: 'PLD',
              descripcion: 'Penalidad',
              unidadMedidaId: unidadMedida.id,
              precioUnitario: 0,
              valorUnitario: 0,
              igvPorcentaje: 0,
              stock: 0,
              tipoAfectacionIGV: '10',
              estado: 'INACTIVO',
            },
          ],
        },
        costoActivacionReseller: planSeleccionado.costo,
      } as any,
      include: { plan: true, productos: true, clientes: true },
    });

    // Crear Sede Principal automáticamente
    await this.sedeService.create({
      nombre: 'Sede Principal',
      direccion: data.direccion,
      codigo: '001',
      esPrincipal: true,
    }, empresa.id);

    // Log creación
    if (adminUserId) {
      await this.registrarLog(empresa.id, 'CREADA',
        `Plan: ${planSeleccionado.nombre} | Admin: ${data.usuario.email}`, adminUserId);
    }

    return empresa;
  }

  async listar(params: {
    search?: string;
    page?: number;
    limit?: number;
    sort?: 'id' | 'ruc' | 'razonSocial' | 'fechaActivacion' | 'fechaExpiracion';
    order?: 'asc' | 'desc';
    estado?: 'ACTIVO' | 'INACTIVO' | 'TODOS';
    tipoEmpresa?: 'FORMAL' | 'INFORMAL' | '';
    brand?: string;
  }, adminSistemaNegocio?: string | null) {
    const {
      search,
      page = 1,
      limit = 10,
      sort = 'id',
      order = 'desc',
      estado = 'TODOS',
      tipoEmpresa = '',
      brand,
    } = params;
    const skip = (page - 1) * limit;

    // Si el admin tiene sistemaNegocio, siempre forzar ese brand (ignora el brand del query)
    const brandFiltro = adminSistemaNegocio
      ? adminSistemaNegocio.toLowerCase()
      : brand;

    let where: any = {};

    // Filtro por estado
    if (estado !== 'TODOS') {
      where.estado = estado;
    }

    // Filtro por tipo de empresa
    if (tipoEmpresa) {
      where.tipoEmpresa = tipoEmpresa;
    }

    // Filtro por brand (forzado por sistemaNegocio o enviado en query)
    if (brandFiltro) {
      where.brand = brandFiltro;
    }

    if (search) {
      where = {
        AND: [
          ...(estado !== 'TODOS' ? [{ estado }] : []),
          ...(tipoEmpresa ? [{ tipoEmpresa }] : []),
          ...(brandFiltro ? [{ brand: brandFiltro }] : []),
          {
            OR: [
              { ruc: { contains: search } },
              { razonSocial: { contains: search } },
            ],
          },
        ],
      };
    }

    const [empresas, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort]: order },
        select: {
          id: true,
          ruc: true,
          razonSocial: true,
          nombreComercial: true,
          tipoEmpresa: true,
          estado: true,
          direccion: true,
          fechaActivacion: true,
          fechaExpiracion: true,
          logo: true,
          slugTienda: true,
          plan: {
            select: {
              nombre: true,
              costo: true,
              descripcion: true,
              maxSedes: true,
              tieneTienda: true,
            },
          },
          rubro: {
            select: {
              id: true,
              nombre: true,
            },
          },
        },
      }),
      this.prisma.empresa.count({ where }),
    ]);

    return {
      empresas: empresas.map((e) => ({
        id: e.id,
        ruc: e.ruc,
        razonSocial: e.razonSocial,
        nombreComercial: e.nombreComercial,
        tipoEmpresa: e.tipoEmpresa,
        direccion: e.direccion,
        estado: e.estado,
        logo: e.logo,
        fechaActivacion: e.fechaActivacion,
        fechaExpiracion: e.fechaExpiracion,
        slugTienda: e.slugTienda,
        rubro: e.rubro,
        plan: {
          nombre: e.plan.nombre,
          costo: e.plan.costo,
          maxSedes: e.plan.maxSedes,
          descripcion: e.plan.descripcion,
          tieneTienda: e.plan.tieneTienda,
        },
      })),
      total,
      page,
      limit,
    };
  }

  async actualizar(dto: UpdateEmpresaDto) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: dto.id },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    try {
      // Preparar datos para actualizar, excluyendo campos undefined
      const updateData: any = {};
      if (dto.ruc !== undefined) updateData.ruc = dto.ruc;
      if (dto.razonSocial !== undefined)
        updateData.razonSocial = dto.razonSocial;
      if (dto.direccion !== undefined) updateData.direccion = dto.direccion;
      if (dto.planId !== undefined) updateData.planId = dto.planId;
      if (dto.tipoEmpresa !== undefined)
        updateData.tipoEmpresa = dto.tipoEmpresa;
      if (dto.departamento !== undefined)
        updateData.departamento = dto.departamento;
      if (dto.provincia !== undefined) updateData.provincia = dto.provincia;
      if (dto.distrito !== undefined) updateData.distrito = dto.distrito;
      if (dto.ubigeo !== undefined) updateData.ubigeo = dto.ubigeo;
      if (dto.rubroId !== undefined) updateData.rubroId = dto.rubroId;
      if (dto.nombreComercial !== undefined)
        updateData.nombreComercial = dto.nombreComercial;
      if (dto.fechaActivacion !== undefined)
        updateData.fechaActivacion = parseDDMMYYYY(dto.fechaActivacion);
      if (dto.fechaExpiracion !== undefined)
        updateData.fechaExpiracion = parseDDMMYYYY(dto.fechaExpiracion);
      if (dto.providerToken !== undefined)
        updateData.providerToken = dto.providerToken;
      if (dto.providerId !== undefined) updateData.providerId = dto.providerId;
      if (dto.esAgenteRetencion !== undefined) updateData.esAgenteRetencion = dto.esAgenteRetencion;
      if (dto.usaCodigoBarrasManual !== undefined)
        updateData.usaCodigoBarrasManual = dto.usaCodigoBarrasManual;
      if (dto.logo !== undefined) updateData.logo = dto.logo;
      if (dto.bancoNombre !== undefined) updateData.bancoNombre = dto.bancoNombre;
      if (dto.numeroCuenta !== undefined) updateData.numeroCuenta = dto.numeroCuenta;
      if (dto.cci !== undefined) updateData.cci = dto.cci;
      if (dto.monedaCuenta !== undefined) updateData.monedaCuenta = dto.monedaCuenta;
      if (dto.yapeNumero !== undefined) updateData.yapeNumero = dto.yapeNumero;
      if (dto.yapeQrUrl !== undefined) updateData.yapeQrUrl = dto.yapeQrUrl;
      if (dto.plinNumero !== undefined) updateData.plinNumero = dto.plinNumero;
      if (dto.plinQrUrl !== undefined) updateData.plinQrUrl = dto.plinQrUrl;
      if (dto.brand !== undefined) updateData.brand = dto.brand;
      if (dto.usuarioPse !== undefined) updateData.usuarioPse = dto.usuarioPse;
      if (dto.contrasenaPse !== undefined) updateData.contrasenaPse = dto.contrasenaPse;

      // Actualizar datos de empresa
      const empresaActualizada = await this.prisma.empresa.update({
        where: { id: dto.id },
        data: updateData,
      });

      // Actualizar datos del usuario administrador si se envían
      if (dto.usuario) {
        // Buscar usuario admin de la empresa
        const adminUser = await this.prisma.usuario.findFirst({
          where: {
            empresaId: dto.id,
            rol: { in: ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'] }
          }
        });

        if (adminUser) {
          const userData: any = {};
          if (dto.usuario.nombre !== undefined) userData.nombre = dto.usuario.nombre;
          if (dto.usuario.email !== undefined) userData.email = dto.usuario.email;
          if (dto.usuario.dni !== undefined) userData.dni = dto.usuario.dni;
          if (dto.usuario.celular !== undefined) userData.celular = dto.usuario.celular;

          if (dto.usuario.password && dto.usuario.password.length > 0) {
            // Assuming bcrypt is imported and available
            // If not, you'll need to add `import * as bcrypt from 'bcrypt';` at the top
            userData.password = await bcrypt.hash(dto.usuario.password, 10);
          }

          if (Object.keys(userData).length > 0) {
            await this.prisma.usuario.update({
              where: { id: adminUser.id },
              data: userData
            });
          }
        }
      }

      return empresaActualizada;
    } catch (error: any) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const campo = Array.isArray(error.meta?.target)
          ? (error.meta.target as string[])[0]
          : 'valor único';
        throw new ForbiddenException(`Este ${campo} ya está en uso`);
      }
      throw error;
    }
  }

  async cambiarEstado(id: number, estado: 'ACTIVO' | 'INACTIVO', userId?: number) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    const result = await this.prisma.empresa.update({ where: { id }, data: { estado } });
    if (userId) {
      await this.registrarLog(id, estado === 'ACTIVO' ? 'ACTIVADA' : 'DESACTIVADA', null, userId);
    }
    return result;
  }

  async eliminar(id: number) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    // Eliminar en orden para respetar las relaciones FK
    try {
      // 1. Eliminar detalles de comprobantes
      await this.prisma.detalleComprobante.deleteMany({
        where: { comprobante: { empresaId: id } },
      });

      // 2. Eliminar leyendas de comprobantes
      await this.prisma.leyenda.deleteMany({
        where: { comprobante: { empresaId: id } },
      });

      // 3. Eliminar pagos
      await this.prisma.pago.deleteMany({
        where: { empresaId: id },
      });

      // 4. Eliminar comprobantes
      await this.prisma.comprobante.deleteMany({
        where: { empresaId: id },
      });

      // 5. Eliminar movimientos de kardex (referencia productos)
      await this.prisma.movimientoKardex.deleteMany({
        where: { producto: { empresaId: id } },
      });

      // 6. Eliminar items de pedidos tienda (referencia productos)
      await this.prisma.itemPedidoTienda.deleteMany({
        where: { producto: { empresaId: id } },
      });

      // 7. Eliminar pedidos tienda
      await this.prisma.pedidoTienda.deleteMany({
        where: { empresaId: id },
      });

      // 8. Eliminar productos
      await this.prisma.producto.deleteMany({
        where: { empresaId: id },
      });

      // 9. Eliminar clientes
      await this.prisma.cliente.deleteMany({
        where: { empresaId: id },
      });

      // 10. Eliminar refresh tokens (referencia usuarios)
      await this.prisma.refreshToken.deleteMany({
        where: { usuario: { empresaId: id } },
      });

      // 11. Eliminar movimientos de caja (referencia usuarios)
      await this.prisma.movimientoCaja.deleteMany({
        where: { usuario: { empresaId: id } },
      });

      // 12. Eliminar usuarios
      await this.prisma.usuario.deleteMany({
        where: { empresaId: id },
      });

      // 13. Eliminar categorías
      await this.prisma.categoria.deleteMany({
        where: { empresaId: id },
      });

      // 14. Finalmente eliminar la empresa
      return this.prisma.empresa.delete({ where: { id } });
    } catch (error: any) {
      throw new ForbiddenException(
        `Error al eliminar empresa: ${error.message}. Puede tener datos relacionados que deben eliminarse primero.`,
      );
    }
  }

  async obtenerPorId(id: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      include: {
        plan: true,
        rubro: true,
        usuarios: {
          where: { rol: { in: ['ADMIN_EMPRESA', 'ADMIN_SISTEMA'] } },
          select: {
            id: true,
            nombre: true,
            email: true,
            celular: true,
            dni: true,
            rol: true,
            estado: true,
          },
          take: 1,
        },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    return empresa;
  }

  async obtenerMiEmpresa(empresaId: number) {
    if (!empresaId)
      throw new ForbiddenException(
        'No se pudo determinar la empresa del usuario',
      );
    const empresa = await this.obtenerPorId(empresaId);
    return empresa;
  }

  async consultarRuc(ruc: string) {
    if (!ruc || ruc.length !== 11) {
      throw new ForbiddenException('El RUC debe tener 11 dígitos');
    }

    try {
      const token = process.env.RENIEC_TOKEN;
      const url = 'https://apiperu.dev/api/ruc';
      const body = { ruc };

      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data?.data;
    } catch (error: any) {
      throw new ForbiddenException(
        'Error al consultar RUC: ' +
        (error.response?.data?.message || error.message),
      );
    }
  }

  async obtenerEmpresasProximasVencer(diasAntes: number = 7) {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + diasAntes);

    const empresas = await this.prisma.empresa.findMany({
      where: {
        estado: 'ACTIVO',
        fechaExpiracion: {
          lte: fechaLimite,
          gte: new Date(), // Solo futuras, no vencidas
        },
      },
      include: {
        plan: {
          select: {
            nombre: true,
            costo: true,
            tipoFacturacion: true,
          },
        },
      },
      orderBy: {
        fechaExpiracion: 'asc',
      },
    });

    return empresas.map((empresa) => ({
      id: empresa.id,
      ruc: empresa.ruc,
      razonSocial: empresa.razonSocial,
      nombreComercial: empresa.nombreComercial,
      fechaExpiracion: empresa.fechaExpiracion,
      diasRestantes: Math.ceil(
        (empresa.fechaExpiracion.getTime() - new Date().getTime()) /
        (1000 * 60 * 60 * 24),
      ),
      plan: empresa.plan,
    }));
  }

  // ── NOTAS INTERNAS ─────────────────────────────────────────────────────────

  private async resolverAutor(userId: number): Promise<{ nombre: string; email: string }> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: { nombre: true, email: true },
    });
    return { nombre: usuario?.nombre ?? 'Admin', email: usuario?.email ?? 'sistema' };
  }

  async listarNotas(empresaId: number) {
    return this.prisma.notaEmpresa.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async crearNota(empresaId: number, contenido: string, userId: number, notificar = false) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    const autor = await this.resolverAutor(userId);
    const nota = await this.prisma.notaEmpresa.create({
      data: { empresaId, contenido, autorNombre: autor.nombre, autorEmail: autor.email, notificado: notificar },
    });
    if (notificar) {
      this.enviarEmailNota(empresa, contenido, autor.nombre).catch(() => {});
    }
    return nota;
  }

  private async enviarEmailNota(empresa: any, contenido: string, autorNombre: string) {
    const admins = await this.prisma.usuario.findMany({
      where: { empresaId: empresa.id, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
      select: { email: true },
    });
    const empresaNombre = empresa.nombreComercial || empresa.razonSocial;
    const appName = empresa.brand === 'krezka' ? 'Krezka' : 'Falconext';
    for (const admin of admins) {
      await this.enviarEmailPlantilla(admin.email, {
        tipo: 'NOTA',
        empresaNombre,
        mensajeCustom: contenido,
        adminNombre: autorNombre,
        autorNombre,
        appName,
      }).catch(() => {});
    }
  }

  // ── EMAIL PLANTILLAS ───────────────────────────────────────────────────────

  async enviarEmailTemplate(
    empresaId: number,
    tipo: 'BIENVENIDA' | 'AGRADECIMIENTO' | 'RECORDATORIO' | 'PROMOCION',
    opts: { mensajeCustom?: string; tituloPromo?: string; etiqueta?: string } = {},
  ) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { plan: { select: { nombre: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    const admins = await this.prisma.usuario.findMany({
      where: { empresaId, rol: 'ADMIN_EMPRESA', estado: 'ACTIVO' },
      select: { email: true, nombre: true },
    });
    if (!admins.length) throw new NotFoundException('La empresa no tiene administradores activos');

    const empresaNombre = empresa.nombreComercial || empresa.razonSocial;
    const appName = empresa.brand === 'krezka' ? 'Krezka' : 'Falconext';
    const planNombre = (empresa.plan as any)?.nombre ?? '';
    const fechaExp = empresa.fechaExpiracion;
    const fechaExpiracion = fechaExp?.toLocaleDateString('es-PE') ?? '';
    const diasRestantes = fechaExp
      ? Math.ceil((fechaExp.getTime() - Date.now()) / 86400000)
      : 30;

    let enviados = 0;
    for (const admin of admins) {
      await this.enviarEmailPlantilla(admin.email, {
        tipo,
        empresaNombre,
        adminNombre: admin.nombre,
        mensajeCustom: opts.mensajeCustom,
        tituloPromo: opts.tituloPromo,
        etiqueta: opts.etiqueta,
        fechaExpiracion,
        diasRestantes,
        planNombre,
        appName,
      });
      enviados++;
    }
    return { enviados };
  }

  private async enviarEmailPlantilla(
    destinatario: string,
    opts: {
      tipo: string;
      empresaNombre: string;
      adminNombre: string;
      mensajeCustom?: string;
      tituloPromo?: string;
      etiqueta?: string;
      fechaExpiracion?: string;
      diasRestantes?: number;
      planNombre?: string;
      autorNombre?: string;
      appName: string;
    },
  ) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const { Resend } = await import('resend');
    const { render } = await import('@react-email/render');
    const resend = new Resend(resendKey);
    const fromEmail = process.env.MAIL_FROM || 'notificaciones@falconext.pe';

    const {
      tipo, empresaNombre, adminNombre, mensajeCustom, tituloPromo,
      etiqueta, fechaExpiracion, diasRestantes = 7, planNombre, autorNombre, appName,
    } = opts;

    let asunto = '';
    let html = '';

    if (tipo === 'BIENVENIDA') {
      const { BienvenidaEmail } = await import('./emails/BienvenidaEmail.js');
      asunto = `¡Bienvenido/a a ${appName}! — ${empresaNombre}`;
      html = await render((BienvenidaEmail as any)({ empresaNombre, adminNombre, planNombre, appName, mensajeExtra: mensajeCustom }));
    } else if (tipo === 'AGRADECIMIENTO') {
      const { AgradecimientoEmail } = await import('./emails/AgradecimientoEmail.js');
      asunto = `¡Gracias por tu pago puntual! — ${empresaNombre}`;
      html = await render((AgradecimientoEmail as any)({ empresaNombre, adminNombre, planNombre, fechaExpiracion, appName, mensajeExtra: mensajeCustom }));
    } else if (tipo === 'RECORDATORIO') {
      const { RecordatorioEmail } = await import('./emails/RecordatorioEmail.js');
      asunto = `⏰ Recordatorio: tu suscripción vence en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''} — ${empresaNombre}`;
      html = await render((RecordatorioEmail as any)({ empresaNombre, adminNombre, diasRestantes, fechaExpiracion, planNombre, appName, mensajeExtra: mensajeCustom }));
    } else if (tipo === 'PROMOCION') {
      const { PromocionEmail } = await import('./emails/PromocionEmail.js');
      asunto = `🎁 ${tituloPromo || 'Oferta especial'} — ${empresaNombre}`;
      html = await render((PromocionEmail as any)({ empresaNombre, adminNombre, tituloPromo: tituloPromo || 'Oferta especial', mensajePromo: mensajeCustom || '', appName, etiqueta }));
    } else {
      // NOTA ad-hoc
      const { BienvenidaEmail } = await import('./emails/BienvenidaEmail.js');
      asunto = `Mensaje de ${appName} — ${empresaNombre}`;
      // Para notas usamos HTML simple sin React Email
      html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
  <tr><td align="center">
    <table width="560" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06)">
      <tr><td style="background:#6366f1;padding:28px 32px;text-align:center">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">📩 Mensaje de ${appName}</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">${empresaNombre}</p>
      </td></tr>
      <tr><td style="padding:28px 32px;color:#374151;font-size:15px;line-height:1.7">
        <p style="padding:16px;background:#f8fafc;border-left:4px solid #6366f1;border-radius:0 10px 10px 0;margin:0">${(mensajeCustom ?? '').replace(/\n/g, '<br/>')}</p>
        ${autorNombre ? `<p style="font-size:12px;color:#94a3b8;margin-top:16px">Enviado por ${autorNombre}</p>` : ''}
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;color:#94a3b8;font-size:12px">${appName}</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
    }

    const { error } = await resend.emails.send({
      from: `${appName} <${fromEmail}>`,
      to: destinatario,
      subject: asunto,
      html,
    });
    if (error) throw new Error(error.message);
  }

  async eliminarNota(notaId: number) {
    const nota = await this.prisma.notaEmpresa.findUnique({ where: { id: notaId } });
    if (!nota) throw new NotFoundException('Nota no encontrada');
    return this.prisma.notaEmpresa.delete({ where: { id: notaId } });
  }

  // ── HISTORIAL / AUDITORÍA ─────────────────────────────────────────────────

  async listarLog(empresaId: number) {
    return this.prisma.empresaLog.findMany({
      where: { empresaId },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
  }

  async registrarLog(empresaId: number, accion: string, detalle: string | null, userId: number) {
    try {
      const autor = await this.resolverAutor(userId);
      await this.prisma.empresaLog.create({
        data: { empresaId, accion, detalle, autorNombre: autor.nombre, autorEmail: autor.email },
      });
    } catch { /* nunca debe romper el flujo principal */ }
  }
}
