import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private buildSistemaScope(actor?: { sistemaNegocio?: string | null; sistemaProducto?: string | null }) {
    const where: any = {};
    if (actor?.sistemaNegocio) where.sistemaNegocio = actor.sistemaNegocio;
    if (actor?.sistemaProducto) where.sistemaProducto = actor.sistemaProducto;
    return where;
  }

  async create(dto: CreateUserDto, empresaIdFromToken: number) {
    const { nombre, email, dni, celular, password, permisos, sedeIds, subModuloIds } = dto;

    const existeEmail = await this.prisma.usuario.findUnique({ where: { email } });
    if (existeEmail) throw new BadRequestException('El email ya está en uso');

    if (dni) {
      const existeDni = await this.prisma.usuario.findFirst({ where: { dni } });
      if (existeDni) throw new BadRequestException('El DNI ya está en uso');
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaIdFromToken },
      include: {
        plan: true,
        usuarios: { where: { estado: 'ACTIVO' } },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    const maxUsuarios = empresa.plan.limiteUsuarios;
    const totalUsuariosActivos = empresa.usuarios.length;
    const usuariosIlimitados =
      maxUsuarios === null || maxUsuarios === undefined || maxUsuarios === 0;

    if (!usuariosIlimitados && totalUsuariosActivos >= maxUsuarios) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${maxUsuarios} usuarios permitidos por tu plan (${empresa.plan.nombre}), sube de plan para poder crear más usuarios`,
      );
    }

    const hash = await bcrypt.hash(password, 10);

    const nuevo = await this.prisma.usuario.create({
      data: {
        nombre,
        email,
        dni: dni ?? '',
        celular: celular ?? '',
        password: hash,
        rol: 'USUARIO_EMPRESA',
        empresaId: empresaIdFromToken,
        permisos: permisos ? JSON.stringify(permisos) : null,
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        dni: true,
        celular: true,
        rol: true,
        empresaId: true,
        permisos: true,
        estado: true,
      },
    });

    // Asignar sedes si vienen
    if (sedeIds && sedeIds.length > 0) {
      await this.prisma.usuarioSede.createMany({
        data: sedeIds.map((sedeId) => ({ usuarioId: nuevo.id, sedeId })),
        skipDuplicates: true,
      });
    }

    // Asignar submódulos si vienen
    if (subModuloIds && subModuloIds.length > 0) {
      await this.prisma.usuarioSubModulo.createMany({
        data: subModuloIds.map((subModuloId) => ({ usuarioId: nuevo.id, subModuloId })),
        skipDuplicates: true,
      });
    }

    return nuevo;
  }

  async list(params: {
    empresaId: number;
    search?: string;
    page?: number;
    limit?: number;
    sort?: 'id' | 'nombre' | 'email';
    order?: 'asc' | 'desc';
  }) {
    const {
      empresaId,
      search,
      page = 1,
      limit = 10,
      sort = 'id',
      order = 'desc',
    } = params;

    const where: any = { empresaId };
    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { dni: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nombre: true,
          email: true,
          dni: true,
          celular: true,
          rol: true,
          empresaId: true,
          estado: true,
          permisos: true,
          sedesAsignadas: {
            select: {
              sede: {
                select: { id: true, nombre: true, codigo: true, esPrincipal: true }
              }
            }
          },
          subModulosAsignados: {
            select: {
              subModulo: {
                select: { id: true, codigo: true, nombre: true, moduloId: true }
              }
            }
          },
        },
      }),
    ]);

    // Aplanar sedes y submódulos asignados
    const itemsConSedes = items.map((u) => ({
      ...u,
      sedes: (u.sedesAsignadas || []).map((us: any) => us.sede),
      sedesAsignadas: undefined,
      subModulos: (u.subModulosAsignados || []).map((us: any) => us.subModulo),
      subModulosAsignados: undefined,
    }));

    return { total, page, limit, items: itemsConSedes };
  }

  async changeState(id: number, estado: 'ACTIVO' | 'INACTIVO') {
    const exists = await this.prisma.usuario.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Usuario no encontrado');
    return this.prisma.usuario.update({ where: { id }, data: { estado } });
  }

  async update(dto: UpdateUserDto, empresaId: number) {
    const { id, nombre, email, dni, celular, permisos, sedeIds, subModuloIds } = dto;

    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    if (usuario.empresaId !== empresaId)
      throw new ForbiddenException('Empresa no identificada');

    const updated = await this.prisma.usuario.update({
      where: { id },
      data: {
        nombre,
        email,
        dni,
        celular,
        permisos: permisos ? JSON.stringify(permisos) : undefined,
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        dni: true,
        celular: true,
        rol: true,
        empresaId: true,
        permisos: true,
        estado: true,
      },
    });

    // Sincronizar sedes si vienen
    if (sedeIds !== undefined) {
      await this.prisma.usuarioSede.deleteMany({ where: { usuarioId: id } });
      if (sedeIds.length > 0) {
        await this.prisma.usuarioSede.createMany({
          data: sedeIds.map((sedeId) => ({ usuarioId: id, sedeId })),
          skipDuplicates: true,
        });
      }
    }

    // Sincronizar submódulos si vienen
    if (subModuloIds !== undefined) {
      await this.prisma.usuarioSubModulo.deleteMany({ where: { usuarioId: id } });
      if (subModuloIds.length > 0) {
        await this.prisma.usuarioSubModulo.createMany({
          data: subModuloIds.map((subModuloId) => ({ usuarioId: id, subModuloId })),
          skipDuplicates: true,
        });
      }
    }

    return updated;
  }

  async me(userId: number) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nombre: true,
        email: true,
        dni: true,
        celular: true,
        rol: true,
        empresaId: true,
        permisos: true,
        estado: true,
      },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    return usuario;
  }

  async editProfile(
    userId: number,
    data: { nombre?: string; email?: string; dni?: string; celular?: string },
  ) {
    const usuario = await this.prisma.usuario.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        nombre: true,
        email: true,
        dni: true,
        celular: true,
        rol: true,
        empresaId: true,
      },
    });
    return usuario;
  }

  async changePassword(userId: number, actual: string, nueva: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: userId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const ok = await bcrypt.compare(actual, usuario.password);
    if (!ok) throw new BadRequestException('Contraseña actual incorrecta');

    const hash = await bcrypt.hash(nueva, 10);
    await this.prisma.usuario.update({
      where: { id: userId },
      data: { password: hash },
    });
    return { message: 'Contraseña actualizada correctamente' };
  }

  // ─── ADMIN_SISTEMA: Gestión de usuarios del sistema ──────────────────────────

  async listSistema(
    params: { search?: string; page?: number; limit?: number },
    actorScope?: { sistemaNegocio?: string | null; sistemaProducto?: string | null },
  ) {
    const { search, page = 1, limit = 50 } = params;
    const where: any = { rol: 'ADMIN_SISTEMA', ...this.buildSistemaScope(actorScope) };
    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { dni: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nombre: true,
          email: true,
          dni: true,
          celular: true,
          rol: true,
          estado: true,
          sistemaNegocio: true,
          sistemaProducto: true,
        },
      }),
    ]);
    return { total, page, limit, items };
  }

  async createSistema(
    dto: CreateUserDto & { sistemaNegocio?: string; sistemaProducto?: string },
    actorScope?: { sistemaNegocio?: string | null; sistemaProducto?: string | null },
  ) {
    const { nombre, email, dni, celular, password, sistemaNegocio, sistemaProducto } = dto;

    const existeEmail = await this.prisma.usuario.findUnique({ where: { email } });
    if (existeEmail) throw new BadRequestException('El email ya está en uso');

    if (dni) {
      const existeDni = await this.prisma.usuario.findFirst({ where: { dni } });
      if (existeDni) throw new BadRequestException('El DNI ya está en uso');
    }

    const hash = await bcrypt.hash(password, 10);

    const sistemaNegocioFinal = actorScope?.sistemaNegocio ?? sistemaNegocio ?? null;
    const sistemaProductoFinal = actorScope?.sistemaProducto ?? sistemaProducto ?? null;

    return this.prisma.usuario.create({
      data: {
        nombre,
        email,
        dni: dni ?? '',
        celular: celular ?? '',
        password: hash,
        rol: 'ADMIN_SISTEMA',
        sistemaNegocio: sistemaNegocioFinal,
        sistemaProducto: sistemaProductoFinal,
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        dni: true,
        celular: true,
        rol: true,
        estado: true,
        sistemaNegocio: true,
        sistemaProducto: true,
      },
    });
  }

  async updateSistema(
    id: number,
    data: Partial<{ nombre: string; email: string; dni: string; celular: string; sistemaNegocio: string | null; sistemaProducto: string | null }>,
    actorScope?: { sistemaNegocio?: string | null; sistemaProducto?: string | null },
  ) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, rol: 'ADMIN_SISTEMA', ...this.buildSistemaScope(actorScope) },
    });
    if (!usuario) throw new NotFoundException('Administrador no encontrado');

    const sistemaNegocioFinal =
      actorScope?.sistemaNegocio !== undefined ? actorScope.sistemaNegocio : data.sistemaNegocio;
    const sistemaProductoFinal =
      actorScope?.sistemaProducto !== undefined ? actorScope.sistemaProducto : data.sistemaProducto;

    return this.prisma.usuario.update({
      where: { id },
      data: {
        nombre: data.nombre,
        email: data.email,
        dni: data.dni,
        celular: data.celular,
        ...(sistemaNegocioFinal !== undefined ? { sistemaNegocio: sistemaNegocioFinal } : {}),
        ...(sistemaProductoFinal !== undefined ? { sistemaProducto: sistemaProductoFinal } : {}),
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        dni: true,
        celular: true,
        rol: true,
        estado: true,
        sistemaNegocio: true,
        sistemaProducto: true,
      },
    });
  }

  async changeStateSistema(
    id: number,
    estado: 'ACTIVO' | 'INACTIVO',
    actorScope?: { sistemaNegocio?: string | null; sistemaProducto?: string | null },
  ) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, rol: 'ADMIN_SISTEMA', ...this.buildSistemaScope(actorScope) },
      select: { id: true },
    });
    if (!usuario) throw new NotFoundException('Administrador no encontrado');
    return this.prisma.usuario.update({ where: { id }, data: { estado } });
  }

  async deleteSistema(id: number, actorScope?: { sistemaNegocio?: string | null; sistemaProducto?: string | null }) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, rol: 'ADMIN_SISTEMA', ...this.buildSistemaScope(actorScope) },
    });
    if (!usuario) throw new NotFoundException('Administrador no encontrado');
    return this.prisma.usuario.update({
      where: { id },
      data: { estado: 'INACTIVO' },
      select: { id: true, nombre: true, estado: true },
    });
  }

  async getRankingVendedores(params: {
    empresaId: number;
    fechaInicio: string;
    fechaFin: string;
    sedeId?: number;
  }) {
    const { empresaId, fechaInicio, fechaFin, sedeId } = params;

    const baseWhere: any = {
      empresaId,
      tipoDoc: { in: ['01', '03'] },
      estadoEnvioSunat: { not: 'ANULADO' },
      usuarioId: { not: null },
      ...(sedeId ? { sedeId } : {}),
    };

    const inicio = new Date(`${fechaInicio}T00:00:00-05:00`);
    const fin = new Date(`${fechaFin}T23:59:59-05:00`);
    const duracionMs = fin.getTime() - inicio.getTime();
    const prevFin = new Date(inicio.getTime() - 1);
    const prevInicio = new Date(inicio.getTime() - duracionMs - 1);

    const [grouped, prevGrouped] = await Promise.all([
      this.prisma.comprobante.groupBy({
        by: ['usuarioId'],
        where: { ...baseWhere, fechaEmision: { gte: inicio, lte: fin } },
        _sum: { mtoImpVenta: true },
        _count: { id: true },
        orderBy: { _sum: { mtoImpVenta: 'desc' } },
      }),
      this.prisma.comprobante.groupBy({
        by: ['usuarioId'],
        where: { ...baseWhere, fechaEmision: { gte: prevInicio, lte: prevFin } },
        _sum: { mtoImpVenta: true },
      }),
    ]);

    const userIds = grouped.map((g) => g.usuarioId).filter(Boolean) as number[];
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nombre: true, email: true, rol: true },
    });

    const prevMap = new Map(prevGrouped.map((g) => [g.usuarioId, Number(g._sum.mtoImpVenta || 0)]));
    const usuarioMap = new Map(usuarios.map((u) => [u.id, u]));

    return grouped.map((g, idx) => {
      const totalActual = Number(g._sum.mtoImpVenta || 0);
      const totalAnterior = prevMap.get(g.usuarioId!) || 0;
      const count = g._count.id;
      const crecimientoPct = totalAnterior > 0
        ? Number((((totalActual - totalAnterior) / totalAnterior) * 100).toFixed(1))
        : null;
      return {
        posicion: idx + 1,
        usuario: usuarioMap.get(g.usuarioId!) ?? null,
        totalVentas: Number(totalActual.toFixed(2)),
        numComprobantes: count,
        ticketPromedio: count > 0 ? Number((totalActual / count).toFixed(2)) : 0,
        totalVentasPeriodoAnterior: Number(totalAnterior.toFixed(2)),
        crecimientoPct,
      };
    });
  }

  async getDetalleVendedor(params: {
    empresaId: number;
    usuarioId: number;
    fechaInicio: string;
    fechaFin: string;
  }) {
    const { empresaId, usuarioId, fechaInicio, fechaFin } = params;

    const [usuario, comprobantes] = await Promise.all([
      this.prisma.usuario.findFirst({
        where: { id: usuarioId, empresaId },
        select: { id: true, nombre: true, email: true, rol: true },
      }),
      this.prisma.comprobante.findMany({
        where: {
          empresaId,
          usuarioId,
          tipoDoc: { in: ['01', '03'] },
          estadoEnvioSunat: { not: 'ANULADO' },
          fechaEmision: {
            gte: new Date(`${fechaInicio}T00:00:00-05:00`),
            lte: new Date(`${fechaFin}T23:59:59-05:00`),
          },
        },
        include: { cliente: { select: { nombre: true } } },
        orderBy: { fechaEmision: 'desc' },
      }),
    ]);

    if (!usuario) throw new NotFoundException('Vendedor no encontrado');

    // Agrupar por día para el gráfico
    const byDay: Record<string, number> = {};
    for (const c of comprobantes) {
      const d = new Date(c.fechaEmision);
      const peruDate = new Date(d.getTime() - 5 * 60 * 60 * 1000);
      const day = peruDate.toISOString().split('T')[0];
      byDay[day] = (byDay[day] || 0) + Number(c.mtoImpVenta);
    }

    const chartData = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, total]) => ({ fecha, total: Number(total.toFixed(2)) }));

    return {
      usuario,
      chartData,
      comprobantes: comprobantes.map((c) => ({
        id: c.id,
        serie: c.serie,
        correlativo: c.correlativo,
        tipoDoc: c.tipoDoc,
        fechaEmision: c.fechaEmision,
        clienteNombre: (c as any).cliente?.nombre ?? '-',
        total: Number(c.mtoImpVenta.toFixed(2)),
        estadoEnvioSunat: c.estadoEnvioSunat,
      })),
    };
  }
}
