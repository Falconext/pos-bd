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

  async create(dto: CreateUserDto, empresaIdFromToken: number) {
    const { nombre, email, dni, celular, password, permisos, sedeIds, subModuloIds } = dto;

    const existeEmail = await this.prisma.usuario.findUnique({ where: { email } });
    if (existeEmail) throw new BadRequestException('El email ya está en uso');

    const existeDni = await this.prisma.usuario.findFirst({ where: { dni } });
    if (existeDni) throw new BadRequestException('El DNI ya está en uso');

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
    if (
      maxUsuarios !== null &&
      maxUsuarios !== undefined &&
      totalUsuariosActivos >= maxUsuarios
    ) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${maxUsuarios} usuarios permitidos por tu plan (${empresa.plan.nombre}), sube de plan para poder crear más usuarios`,
      );
    }

    const hash = await bcrypt.hash(password, 10);

    const nuevo = await this.prisma.usuario.create({
      data: {
        nombre,
        email,
        dni,
        celular,
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

  async listSistema(params: { search?: string; page?: number; limit?: number }) {
    const { search, page = 1, limit = 50 } = params;
    const where: any = { rol: 'ADMIN_SISTEMA' };
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
        },
      }),
    ]);
    return { total, page, limit, items };
  }

  async createSistema(dto: CreateUserDto & { sistemaNegocio?: string }) {
    const { nombre, email, dni, celular, password, sistemaNegocio } = dto;

    const existeEmail = await this.prisma.usuario.findUnique({ where: { email } });
    if (existeEmail) throw new BadRequestException('El email ya está en uso');

    const existeDni = await this.prisma.usuario.findFirst({ where: { dni } });
    if (existeDni) throw new BadRequestException('El DNI ya está en uso');

    const hash = await bcrypt.hash(password, 10);

    return this.prisma.usuario.create({
      data: {
        nombre,
        email,
        dni,
        celular,
        password: hash,
        rol: 'ADMIN_SISTEMA',
        sistemaNegocio: sistemaNegocio || null,
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
      },
    });
  }

  async updateSistema(id: number, data: Partial<{ nombre: string; email: string; dni: string; celular: string; sistemaNegocio: string | null }>) {
    const usuario = await this.prisma.usuario.findFirst({ where: { id, rol: 'ADMIN_SISTEMA' } });
    if (!usuario) throw new NotFoundException('Administrador no encontrado');

    return this.prisma.usuario.update({
      where: { id },
      data: {
        nombre: data.nombre,
        email: data.email,
        dni: data.dni,
        celular: data.celular,
        ...(data.sistemaNegocio !== undefined ? { sistemaNegocio: data.sistemaNegocio } : {}),
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
      },
    });
  }

  async deleteSistema(id: number) {
    const usuario = await this.prisma.usuario.findFirst({ where: { id, rol: 'ADMIN_SISTEMA' } });
    if (!usuario) throw new NotFoundException('Administrador no encontrado');
    return this.prisma.usuario.update({
      where: { id },
      data: { estado: 'INACTIVO' },
      select: { id: true, nombre: true, estado: true },
    });
  }
}
