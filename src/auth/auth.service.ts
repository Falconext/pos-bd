import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

interface LoginPayload {
  email: string;
  password: string;
  brand?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessExpiresInSec: number;
  private readonly refreshExpiresInSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    const accessEnv =
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '86400';
    const refreshEnv =
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '604800';
    const nodeEnv =
      this.config.get<string>('NODE_ENV') ||
      process.env.NODE_ENV ||
      'development';
    const isProduction = nodeEnv === 'production';

    this.accessExpiresInSec = isProduction ? Number(accessEnv) || 86400 : 86400;
    this.refreshExpiresInSec = isProduction
      ? Number(refreshEnv) || 604800
      : 604800;
  }

  private resolveBrandFromOrigin(origin: string | undefined): string | null {
    if (!origin) return null;
    if (origin.includes('krezka.com') || origin.includes('krezka.pe'))
      return 'krezka';
    if (origin.includes('falconext.pe') || origin.includes('falconext.app'))
      return 'falconext';
    // localhost/dev: sin restricción
    return null;
  }

  async login(
    { email, password, brand: bodyBrand }: LoginPayload,
    origin?: string,
  ) {
    const user: any = await this.prisma.usuario.findUnique({
      where: { email },
      include: { empresa: true },
    } as any);
    if (!user) throw new UnauthorizedException('Credenciales inválidas');
    if (user.estado !== 'ACTIVO')
      throw new ForbiddenException('Cuenta inactiva');

    if (user.empresaId && user.empresa?.estado !== 'ACTIVO') {
      throw new ForbiddenException(
        'La empresa está inactiva. Contacte con soporte.',
      );
    }

    if (
      user.empresa?.fechaExpiracion &&
      user.empresa.fechaExpiracion < new Date()
    ) {
      throw new ForbiddenException(
        'Tu plan venció. Contacta a tu asesor o proveedor para renovarlo y seguir usando el sistema.',
      );
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new UnauthorizedException('Credenciales inválidas');

    // ── Brand validation ─────────────────────────────────────────
    // ADMIN_SISTEMA y RESELLER no tienen empresa, pueden entrar desde cualquier frontend
    const rolesLibres = ['ADMIN_SISTEMA', 'RESELLER'];
    if (!rolesLibres.includes(user.rol) && user.empresa) {
      // Origin header tiene prioridad; si no resuelve, usa el brand enviado en el body
      const expectedBrand =
        this.resolveBrandFromOrigin(origin) ?? bodyBrand ?? null;
      if (expectedBrand && user.empresa.brand !== expectedBrand) {
        throw new ForbiddenException(
          `Esta cuenta no pertenece a este portal. Accede desde el portal correcto.`,
        );
      }
    }

    // ── Multi-sede logic ──────────────────────────────────────────
    // Solo ADMIN_SISTEMA y RESELLER pueden operar sin sede fija.
    const isSuperAdmin =
      user.rol === 'ADMIN_SISTEMA' || user.rol === 'RESELLER';

    let sedeIdFinal: number | null = null;
    let requiresSedeSelection = false;
    let sedesDisponibles: any[] = [];

    if (!isSuperAdmin) {
      let sedesActivas: Array<{
        id: number;
        nombre: string;
        codigo: string | null;
        esPrincipal: boolean;
        activo: boolean;
      }> = [];

      if (user.rol === 'ADMIN_EMPRESA') {
        // Admin de empresa: usar todas las sedes activas de su empresa.
        sedesActivas = await this.prisma.sede.findMany({
          where: { empresaId: user.empresaId, activo: true },
          select: {
            id: true,
            nombre: true,
            codigo: true,
            tipo: true,
            esPrincipal: true,
            activo: true,
          },
          orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
        });
      } else {
        // Usuario de empresa: usar sedes asignadas al usuario.
        const usuarioSedes = await this.prisma.usuarioSede.findMany({
          where: { usuarioId: user.id },
          include: {
            sede: {
              select: {
                id: true,
                nombre: true,
                codigo: true,
                tipo: true,
                esPrincipal: true,
                activo: true,
              },
            },
          },
        });
        sedesActivas = usuarioSedes
          .filter((us) => us.sede.activo)
          .map((us) => us.sede);
      }

      if (sedesActivas.length === 0) {
        throw new ForbiddenException(
          'No tienes sedes activas disponibles. Contacta al administrador de tu empresa.',
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
      sistemaProducto: user.sistemaProducto ?? null,
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

  /**
   * Intercambia una identidad OAuth verificada (por NextAuth en el portal de
   * developers) por los tokens estándar del ERP. Busca al usuario primero por
   * el proveedor (googleId/githubId) y, si no hay match, por email. En el
   * primer login por email guarda el providerId para reconocerlo la próxima.
   *
   * No crea usuarios: el developer debe existir ya como Usuario en MyPE.
   */
  async oauthSignin(input: {
    provider: 'google' | 'github';
    providerId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }) {
    const { provider, providerId, email, name, avatarUrl } = input;
    if (!providerId || !email) {
      throw new BadRequestException('providerId y email son obligatorios');
    }

    const providerField = provider === 'google' ? 'googleId' : 'githubId';

    let user: any = await this.prisma.usuario.findFirst({
      where: { [providerField]: providerId } as any,
      include: { empresa: true },
    });

    if (!user) {
      user = await this.prisma.usuario.findUnique({
        where: { email: email.toLowerCase() },
        include: { empresa: true },
      });
      if (!user) {
        throw new UnauthorizedException(
          'No encontramos una cuenta con este correo. Regístrate primero en Falconext MyPE.',
        );
      }
      // Enlaza el proveedor a este usuario para futuros logins.
      await this.prisma.usuario.update({
        where: { id: user.id },
        data: {
          [providerField]: providerId,
          ...(avatarUrl && !user.avatarUrl ? { avatarUrl } : {}),
          ...(name && !user.nombre ? { nombre: name } : {}),
        } as any,
      });
    }

    if (user.estado !== 'ACTIVO') {
      throw new ForbiddenException('Cuenta inactiva');
    }
    if (user.empresaId && user.empresa?.estado !== 'ACTIVO') {
      throw new ForbiddenException('La empresa está inactiva.');
    }

    // Resolver primera sede disponible (developers no necesitan selector).
    let sedeIdFinal: number | null = null;
    const isSuperAdmin =
      user.rol === 'ADMIN_SISTEMA' || user.rol === 'RESELLER';
    if (!isSuperAdmin && user.empresaId) {
      if (user.rol === 'ADMIN_EMPRESA') {
        const sede = await this.prisma.sede.findFirst({
          where: { empresaId: user.empresaId, activo: true },
          orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
          select: { id: true },
        });
        sedeIdFinal = sede?.id ?? null;
      } else {
        const usuarioSede = await this.prisma.usuarioSede.findFirst({
          where: { usuarioId: user.id, sede: { activo: true } },
          include: { sede: { select: { id: true, esPrincipal: true } } },
          orderBy: { sedeId: 'asc' },
        });
        sedeIdFinal = usuarioSede?.sede?.id ?? null;
      }
    }

    const payload: any = {
      sub: user.id,
      rol: user.rol as string,
      empresaId: user.empresaId ?? null,
      sistemaNegocio: user.sistemaNegocio ?? null,
      sistemaProducto: user.sistemaProducto ?? null,
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

    return {
      accessToken,
      refreshToken,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        empresaId: user.empresaId,
        avatarUrl: (user as any).avatarUrl ?? avatarUrl ?? null,
      },
    };
  }

  async selectSede(userId: number, sedeId: number) {
    const user = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: { empresa: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const isAdmin =
      user.rol === 'ADMIN_EMPRESA' ||
      user.rol === 'ADMIN_SISTEMA' ||
      user.rol === 'RESELLER';

    let sede: any;

    if (isAdmin) {
      console.log(
        `[selectSede] isAdmin=true, userId=${userId}, user.empresaId=${user.empresaId}, sedeId=${sedeId}, typeof sedeId=${typeof sedeId}`,
      );
      // ADMIN_EMPRESA puede seleccionar cualquier sede activa de su empresa
      sede = await this.prisma.sede.findFirst({
        where: {
          id: sedeId,
          empresaId: user.empresaId ?? undefined,
          activo: true,
        },
      });
      if (!sede) {
        console.log(
          `[selectSede] sede NOT FOUND! Params -> id: ${sedeId}, empresaId: ${user.empresaId}`,
        );
        const debugSede = await this.prisma.sede.findUnique({
          where: { id: sedeId },
        });
        console.log(
          `[selectSede] Database actually has for id ${sedeId}:`,
          debugSede,
        );
        throw new ForbiddenException('Sede no encontrada o inactiva');
      }
    } else {
      // USUARIO_EMPRESA: validar a través de la tabla de asignación
      const usuarioSede = await this.prisma.usuarioSede.findUnique({
        where: { usuarioId_sedeId: { usuarioId: userId, sedeId } },
        include: { sede: true },
      });
      if (!usuarioSede)
        throw new ForbiddenException('No tienes acceso a esta sede');
      if (!usuarioSede.sede.activo)
        throw new ForbiddenException('Esta sede está inactiva');
      sede = usuarioSede.sede;
    }

    const payload: any = {
      sub: user.id,
      rol: user.rol as string,
      empresaId: user.empresaId ?? null,
      sedeId,
      sistemaNegocio: user.sistemaNegocio ?? null,
      sistemaProducto: user.sistemaProducto ?? null,
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
      sede,
    };
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        usuario: { include: { empresa: true } },
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

    if (
      user.rol !== 'ADMIN_SISTEMA' &&
      user.rol !== 'RESELLER' &&
      user.empresaId &&
      user.empresa?.estado !== 'ACTIVO'
    ) {
      throw new ForbiddenException(
        'La empresa está inactiva. Contacte con soporte.',
      );
    }

    // Recuperar sedeId del refresh token anterior (incluido en el payload al hacer login)
    const decoded = this.jwt.decode(refreshToken);
    const sedeId: number | null = decoded?.sedeId ?? null;

    const payload: any = {
      sub: user.id,
      rol: user.rol as string,
      empresaId: user.empresaId ?? null,
      sistemaNegocio: (user as any).sistemaNegocio ?? null,
      sistemaProducto: (user as any).sistemaProducto ?? null,
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
        sistemaProducto: true,
        sedesAsignadas: {
          select: {
            sede: {
              select: {
                id: true,
                nombre: true,
                codigo: true,
                tipo: true,
                esPrincipal: true,
                activo: true,
              },
            },
          },
        },
        subModulosAsignados: {
          select: {
            subModulo: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                moduloId: true,
                ruta: true,
                orden: true,
              },
            },
          },
        },
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            nombreComercial: true,
            paginaWeb: true,
            cuentaDetraccionBN: true,
            direccion: true,
            logo: true,
            esAgenteRetencion: true,
            usaCodigoBarrasManual: true,
            ticketLogoSize: true,
            usarPrecioLoteFefo: true,
            cotizMostrarEmail: true,
            cotizMostrarCuentas: true,
            cotizMostrarRazonSocial: true,
            cotizMostrarDetraccion: true,
            cotizFormatoConfig: true,
            tipoEmpresa: true,
            rubroId: true,
            cuentasBancarias: {
              where: { activo: true },
              orderBy: { id: 'asc' },
              select: {
                banco: true,
                numeroCuenta: true,
                cci: true,
                titular: true,
                moneda: true,
                mostrarEnCotizacion: true,
              },
            },
            rubro: {
              include: {
                features: {
                  select: {
                    featureKey: true,
                    enabledByDefault: true,
                  },
                },
              },
            },
            slugTienda: true,
            ruc: true,
            brand: true,
            producto: true,
            plan: {
              select: {
                nombre: true,
                tieneTienda: true,
                tieneDeliveryGPS: true,
                tieneGestionLotes: true,
                tieneGestionProvisiones: true,
                features: {
                  select: {
                    featureKey: true,
                    enabled: true,
                  },
                },
                maxSedes: true,
                modulosAsignados: {
                  include: {
                    modulo: {
                      include: {
                        subModulos: {
                          where: { activo: true },
                          orderBy: { orden: 'asc' },
                        },
                      },
                    },
                  },
                },
                subModulosAsignados: {
                  include: {
                    subModulo: {
                      select: {
                        id: true,
                        codigo: true,
                        nombre: true,
                        moduloId: true,
                        ruta: true,
                        orden: true,
                      },
                    },
                  },
                },
              },
            },
            bancoNombre: true,
            numeroCuenta: true,
            cci: true,
            monedaCuenta: true,
            reseller: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                whiteLabelNombre: true,
                whiteLabelWebsite: true,
              },
            },
          },
        },
      },
    } as any);

    if (!usuario) return null;

    if (usuario.empresa?.plan?.features) {
      usuario.empresa.plan.features = Object.fromEntries(
        usuario.empresa.plan.features.map((feature: any) => [
          feature.featureKey,
          feature.enabled,
        ]),
      );
    }

    if (usuario.empresa?.rubro?.features) {
      usuario.empresa.rubro.features = Object.fromEntries(
        usuario.empresa.rubro.features.map((feature: any) => [
          feature.featureKey,
          feature.enabledByDefault,
        ]),
      );
    }

    // Parsear permisos
    if (usuario.permisos) {
      try {
        usuario.permisos = JSON.parse(usuario.permisos);
      } catch {
        usuario.permisos = [];
      }
    }

    // Aplanar sedes
    if (usuario.rol === 'ADMIN_EMPRESA' && usuario.empresaId) {
      usuario.sedes = await this.prisma.sede.findMany({
        where: { empresaId: usuario.empresaId, activo: true },
        select: {
          id: true,
          nombre: true,
          codigo: true,
          tipo: true,
          esPrincipal: true,
          activo: true,
        },
        orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
      });
    } else {
      usuario.sedes = (usuario.sedesAsignadas || []).map((us: any) => us.sede);
    }
    delete usuario.sedesAsignadas;

    // Aplanar submódulos del usuario
    usuario.subModulos = (usuario.subModulosAsignados || []).map(
      (us: any) => us.subModulo,
    );
    delete usuario.subModulosAsignados;

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
            paginaWeb: true,
            cuentaDetraccionBN: true,
            direccion: true,
            logo: true,
            esAgenteRetencion: true,
            usaCodigoBarrasManual: true,
            ticketLogoSize: true,
            usarPrecioLoteFefo: true,
            cotizMostrarEmail: true,
            cotizMostrarCuentas: true,
            cotizMostrarRazonSocial: true,
            cotizMostrarDetraccion: true,
            cotizFormatoConfig: true,
            directorTecnico: true,
            whatsappProvider: true,
            whatsappApiToken: true,
            shalomEmail: true,
            shalomPassword: true,
            whatsappPhoneNumberId: true,
            whatsappBusinessId: true,
            whatsappActivo: true,
            ruc: true,
            fechaActivacion: true,
            fechaExpiracion: true,
            tipoEmpresa: true,
            rubroId: true,
            departamento: true,
            provincia: true,
            distrito: true,
            cuentasBancarias: {
              where: { activo: true },
              orderBy: { id: 'asc' },
              select: {
                banco: true,
                numeroCuenta: true,
                cci: true,
                titular: true,
                moneda: true,
                mostrarEnCotizacion: true,
              },
            },
            rubro: {
              select: {
                id: true,
                nombre: true,
                features: {
                  select: {
                    featureKey: true,
                    enabledByDefault: true,
                  },
                },
              },
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
                tieneDeliveryGPS: true,
                tieneGestionLotes: true,
                tieneGestionProvisiones: true,
                features: {
                  select: {
                    featureKey: true,
                    enabled: true,
                  },
                },
                modulosAsignados: {
                  include: {
                    modulo: {
                      include: {
                        subModulos: {
                          where: { activo: true },
                          orderBy: { orden: 'asc' },
                        },
                      },
                    },
                  },
                },
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
            reseller: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                whiteLabelNombre: true,
                whiteLabelWebsite: true,
              },
            },
          },
        },
      },
    } as any);

    if (usuario?.permisos) {
      try {
        usuario.permisos = JSON.parse(usuario.permisos);
      } catch {
        usuario.permisos = [];
      }
    }

    if (usuario?.empresa) {
      if (usuario.empresa.plan?.features) {
        usuario.empresa.plan.features = Object.fromEntries(
          usuario.empresa.plan.features.map((feature: any) => [
            feature.featureKey,
            feature.enabled,
          ]),
        );
      }
      if (usuario.empresa.rubro?.features) {
        usuario.empresa.rubro.features = Object.fromEntries(
          usuario.empresa.rubro.features.map((feature: any) => [
            feature.featureKey,
            feature.enabledByDefault,
          ]),
        );
      }
      usuario.empresa.whatsappApiTokenConfigured = Boolean(
        usuario.empresa.whatsappApiToken,
      );
      delete usuario.empresa.whatsappApiToken;
      // Shalom Pro: exponer solo un booleano; nunca la contraseña.
      usuario.empresa.shalomConfigured = Boolean(
        usuario.empresa.shalomPassword,
      );
      delete usuario.empresa.shalomPassword;
    }

    return usuario;
  }

  async forgotPassword(
    email: string,
    brand?: string,
    origin?: string,
  ): Promise<void> {
    const user = await (this.prisma.usuario as any).findUnique({
      where: { email },
      include: { empresa: { select: { brand: true } } },
    });
    // Always return silently to avoid user enumeration
    if (!user) return;

    // DB es la fuente de verdad — empresa.brand tiene prioridad sobre lo que
    // envía el frontend, que depende del modo de arranque del dev server.
    const resolvedBrand =
      user.empresa?.brand || this.resolveBrandFromOrigin(origin) || brand;

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await (this.prisma.usuario as any).update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetExpires: expires,
      },
    });

    const resendKey =
      this.config.get<string>('RESEND_API_KEY') || process.env.RESEND_API_KEY;
    if (!resendKey) return;

    const defaultFromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL') ||
      process.env.RESEND_FROM_EMAIL ||
      'noreply@falconext.pe';

    const brandConfigs: Record<
      string,
      {
        appName: string;
        fromEmail: string;
        frontendUrl: string;
        primaryColor: string;
        replyToEmail: string;
      }
    > = {
      falconext: {
        appName: 'Falconext',
        fromEmail: defaultFromEmail,
        frontendUrl: 'https://app.falconext.pe',
        primaryColor: '#3E2BC7',
        replyToEmail: 'ventas@falconext.pe',
      },
      krezka: {
        appName: 'Krezka',
        fromEmail: defaultFromEmail,
        frontendUrl: 'https://app.krezka.com',
        primaryColor: '#00D0D4',
        replyToEmail: 'ventas@krezka.com',
      },
    };

    const cfg = brandConfigs[resolvedBrand?.toLowerCase() ?? ''] ?? {
      appName:
        this.config.get<string>('APP_NAME') ||
        process.env.APP_NAME ||
        'Falconext',
      fromEmail: defaultFromEmail,
      frontendUrl:
        this.config.get<string>('FRONTEND_URL') ||
        process.env.FRONTEND_URL ||
        'http://localhost:5173',
      primaryColor: '#3E2BC7',
      replyToEmail:
        this.config.get<string>('RESEND_REPLY_TO_EMAIL') ||
        process.env.RESEND_REPLY_TO_EMAIL ||
        'ventas@falconext.pe',
    };

    const resetUrl = `${cfg.frontendUrl}/restablecer-contrasena?token=${token}`;

    const { Resend } = await import('resend');
    const { render } = await import('@react-email/components');
    const { RecuperacionPasswordEmail } = await import(
      './emails/RecuperacionPasswordEmail'
    );

    const html = await render(
      RecuperacionPasswordEmail({
        nombre: user.nombre,
        resetUrl,
        appName: cfg.appName,
        expiresInMinutes: 15,
        primaryColor: cfg.primaryColor,
      }) as any,
    );

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: `${cfg.appName} <${cfg.fromEmail}>`,
      to: [email],
      subject: `🔐 Recupera tu contraseña — ${cfg.appName}`,
      html,
      replyTo: cfg.replyToEmail,
    });

    if (error) {
      this.logger.error(
        `Error enviando recuperación de contraseña (${cfg.appName})`,
        error,
      );
      throw new BadRequestException(
        'No se pudo enviar el correo de recuperación. Intenta nuevamente.',
      );
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await (this.prisma.usuario as any).findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException(
        'El enlace de recuperación es inválido o ha expirado.',
      );
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await (this.prisma.usuario as any).update({
      where: { id: user.id },
      data: {
        password: hashed,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    // Invalidate all refresh tokens
    await this.prisma.refreshToken.deleteMany({
      where: { usuarioId: user.id },
    });
  }
}
