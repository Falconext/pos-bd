import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

interface LoginPayload {
  email: string;
  password: string;
  brand?: string;
}

@Injectable()
export class AuthService {
  private readonly accessExpiresInSec: number;
  private readonly refreshExpiresInSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    const accessEnv = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '86400';
    const refreshEnv = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '604800';
    const nodeEnv = this.config.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';

    this.accessExpiresInSec = isProduction ? (Number(accessEnv) || 86400) : 86400;
    this.refreshExpiresInSec = isProduction ? (Number(refreshEnv) || 604800) : 604800;
  }

  private resolveBrandFromOrigin(origin: string | undefined): string | null {
    if (!origin) return null;
    if (origin.includes('krezka.com') || origin.includes('krezka.pe')) return 'krezka';
    if (origin.includes('falconext.pe') || origin.includes('falconext.app')) return 'falconext';
    // localhost/dev: sin restricción
    return null;
  }

  async login({ email, password, brand: bodyBrand }: LoginPayload, origin?: string) {
    const user: any = await this.prisma.usuario.findUnique({
      where: { email },
      include: { empresa: true },
    } as any);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.estado !== 'ACTIVO')
      throw new ForbiddenException('Cuenta inactiva');

    if (user.empresaId && user.empresa?.estado !== 'ACTIVO') {
      throw new ForbiddenException('La empresa está inactiva. Contacte con soporte.');
    }

    if (
      user.empresa?.fechaExpiracion &&
      user.empresa.fechaExpiracion < new Date()
    ) {
      throw new ForbiddenException('Suscripción expirada');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new UnauthorizedException('Contraseña incorrecta');

    // ── Brand validation ─────────────────────────────────────────
    // ADMIN_SISTEMA y RESELLER no tienen empresa, pueden entrar desde cualquier frontend
    const rolesLibres = ['ADMIN_SISTEMA', 'RESELLER'];
    if (!rolesLibres.includes(user.rol) && user.empresa) {
      // Origin header tiene prioridad; si no resuelve, usa el brand enviado en el body
      const expectedBrand = this.resolveBrandFromOrigin(origin) ?? bodyBrand ?? null;
      if (expectedBrand && user.empresa.brand !== expectedBrand) {
        throw new ForbiddenException(
          `Esta cuenta no pertenece a este portal. Accede desde el portal correcto.`,
        );
      }
    }

    // ── Multi-sede logic ──────────────────────────────────────────
    // ADMIN_EMPRESA y ADMIN_SISTEMA entran sin restricción de sede
    const isAdmin = user.rol === 'ADMIN_EMPRESA' || user.rol === 'ADMIN_SISTEMA' || user.rol === 'RESELLER';

    let sedeIdFinal: number | null = null;
    let requiresSedeSelection = false;
    let sedesDisponibles: any[] = [];

    if (!isAdmin) {
      // Obtener sedes asignadas al usuario
      const usuarioSedes = await this.prisma.usuarioSede.findMany({
        where: { usuarioId: user.id },
        include: {
          sede: {
            select: { id: true, nombre: true, codigo: true, esPrincipal: true, activo: true }
          }
        },
      });

      // Solo sedes activas
      const sedesActivas = usuarioSedes
        .filter(us => us.sede.activo)
        .map(us => us.sede);

      if (sedesActivas.length === 0) {
        throw new ForbiddenException(
          'No tienes sedes asignadas. Contacta al administrador de tu empresa.'
        );
      }

      if (sedesActivas.length === 1) {
        sedeIdFinal = sedesActivas[0].id;
      } else {
        // Múltiples sedes → necesita seleccionar
        requiresSedeSelection = true;
        sedesDisponibles = sedesActivas;
      }
    }

    const usuarioCompleto = await this.obtenerUsuarioActual(user.id);
    if (!usuarioCompleto)
      throw new NotFoundException('Error al obtener datos del usuario');

    if (requiresSedeSelection) {
      // Emitir token temporal (sin sedeId) marcado como pendiente
      const tempPayload = {
        sub: user.id,
        rol: user.rol as string,
        empresaId: user.empresaId ?? null,
        pendingSedeSelection: true,
      };
      const tempToken = await this.jwt.signAsync(tempPayload, {
        expiresIn: 300, // 5 minutos para elegir sede
      });

      return {
        requiresSedeSelection: true,
        sedes: sedesDisponibles,
        tempToken,
        usuario: usuarioCompleto,
      };
    }

    // Flujo normal: generar tokens definitivos
    const payload: any = {
      sub: user.id,
      rol: user.rol as string,
      empresaId: user.empresaId ?? null,
      sistemaNegocio: user.sistemaNegocio ?? null,
    };
    if (sedeIdFinal) payload.sedeId = sedeIdFinal;

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessExpiresInSec,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sedeId: sedeIdFinal ?? null },
      { expiresIn: this.refreshExpiresInSec },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.prisma.refreshToken.create({
      data: { token: refreshToken, usuarioId: user.id, expiresAt },
    });

    return { accessToken, refreshToken, usuario: usuarioCompleto };
  }

  async selectSede(userId: number, sedeId: number) {
    // Validar que el usuario tiene acceso a esa sede
    const usuarioSede = await this.prisma.usuarioSede.findUnique({
      where: { usuarioId_sedeId: { usuarioId: userId, sedeId } },
      include: { sede: true },
    });

    if (!usuarioSede) {
      throw new ForbiddenException('No tienes acceso a esta sede');
    }
    if (!usuarioSede.sede.activo) {
      throw new ForbiddenException('Esta sede está inactiva');
    }

    const user = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: { empresa: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const payload: any = {
      sub: user.id,
      rol: user.rol as string,
      empresaId: user.empresaId ?? null,
      sedeId,
      sistemaNegocio: user.sistemaNegocio ?? null,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessExpiresInSec,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sedeId },
      { expiresIn: this.refreshExpiresInSec },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.prisma.refreshToken.create({
      data: { token: refreshToken, usuarioId: user.id, expiresAt },
    });

    const usuarioCompleto = await this.obtenerUsuarioActual(user.id);
    return {
      accessToken,
      refreshToken,
      usuario: usuarioCompleto,
      sede: usuarioSede.sede,
    };
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        usuario: { include: { empresa: true } }
      },
    });
    if (!stored) throw new UnauthorizedException('Refresh token inválido');
    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = stored.usuario;

    if (user.estado !== 'ACTIVO') {
      throw new ForbiddenException('Cuenta inactiva');
    }

    if (user.rol !== 'ADMIN_SISTEMA' && user.rol !== 'RESELLER' && user.empresaId && user.empresa?.estado !== 'ACTIVO') {
      throw new ForbiddenException('La empresa está inactiva. Contacte con soporte.');
    }

    // Recuperar sedeId del refresh token anterior (incluido en el payload al hacer login)
    const decoded = this.jwt.decode(refreshToken) as any;
    const sedeId: number | null = decoded?.sedeId ?? null;

    const payload: any = {
      sub: user.id,
      rol: user.rol as string,
      empresaId: user.empresaId ?? null,
      sistemaNegocio: (user as any).sistemaNegocio ?? null,
    };
    if (sedeId) payload.sedeId = sedeId;

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessExpiresInSec,
    });
    const newRefreshToken = await this.jwt.signAsync(
      { sub: user.id, sedeId },
      { expiresIn: this.refreshExpiresInSec },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { id: stored.id } }),
      this.prisma.refreshToken.create({
        data: { token: newRefreshToken, usuarioId: user.id, expiresAt },
      }),
    ]);

    return { accessToken, refreshToken: newRefreshToken };
  }

  async obtenerUsuarioActual(userId: number) {
    const usuario: any = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        celular: true,
        telefono: true,
        empresaId: true,
        resellerId: true,
        estado: true,
        permisos: true,
        sistemaNegocio: true,
        sedesAsignadas: {
          select: {
            sede: {
              select: { id: true, nombre: true, codigo: true, esPrincipal: true, activo: true }
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
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            nombreComercial: true,
            direccion: true,
            logo: true,
            esAgenteRetencion: true,
            usaCodigoBarrasManual: true,
            tipoEmpresa: true,
            rubroId: true,
            rubro: true,
            slugTienda: true,
            ruc: true,
            plan: {
              select: {
                tieneTienda: true,
                maxSedes: true,
                modulosAsignados: {
                  include: { modulo: true }
                },
                subModulosAsignados: {
                  include: {
                    subModulo: {
                      select: { id: true, codigo: true, nombre: true, moduloId: true }
                    }
                  }
                },
              },
            },
            bancoNombre: true,
            numeroCuenta: true,
            cci: true,
            monedaCuenta: true,
          },
        },
      },
    } as any);

    if (!usuario) return null;

    // Parsear permisos
    if (usuario.permisos) {
      try {
        (usuario as any).permisos = JSON.parse(usuario.permisos);
      } catch {
        (usuario as any).permisos = [];
      }
    }

    // Aplanar sedes
    (usuario as any).sedes = (usuario.sedesAsignadas || []).map((us: any) => us.sede);
    delete (usuario as any).sedesAsignadas;

    // Aplanar submódulos del usuario
    (usuario as any).subModulos = (usuario.subModulosAsignados || []).map((us: any) => us.subModulo);
    delete (usuario as any).subModulosAsignados;

    return usuario;
  }

  async obtenerPerfilCompleto(userId: number) {
    const usuario: any = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        celular: true,
        telefono: true,
        empresaId: true,
        resellerId: true,
        estado: true,
        permisos: true,
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            nombreComercial: true,
            direccion: true,
            logo: true,
            esAgenteRetencion: true,
            usaCodigoBarrasManual: true,
            ruc: true,
            fechaActivacion: true,
            fechaExpiracion: true,
            tipoEmpresa: true,
            rubroId: true,
            departamento: true,
            provincia: true,
            distrito: true,
            rubro: {
              select: { id: true, nombre: true },
            },
            plan: {
              select: {
                id: true,
                nombre: true,
                descripcion: true,
                costo: true,
                duracionDias: true,
                tipoFacturacion: true,
                esPrueba: true,
                modulosAsignados: {
                  include: { modulo: true }
                }
              },
            },
            ubicacion: {
              select: {
                codigo: true,
                departamento: true,
                provincia: true,
                distrito: true,
              },
            },
            bancoNombre: true,
            numeroCuenta: true,
            cci: true,
            monedaCuenta: true,
          },
        },
      },
    } as any);

    if (usuario?.permisos) {
      try {
        (usuario as any).permisos = JSON.parse(usuario.permisos);
      } catch {
        (usuario as any).permisos = [];
      }
    }

    return usuario;
  }
}
