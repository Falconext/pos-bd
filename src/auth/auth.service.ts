import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

interface LoginPayload {
  email: string;
  password: string;
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

    // Access token: 1 día (86400s); Refresh token: 7 días (604800s)
    this.accessExpiresInSec = isProduction ? (Number(accessEnv) || 86400) : 86400;
    this.refreshExpiresInSec = isProduction ? (Number(refreshEnv) || 604800) : 604800;
  }

  async login({ email, password }: LoginPayload) {
    const user = await this.prisma.usuario.findUnique({
      where: { email },
      include: { empresa: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.estado !== 'ACTIVO')
      throw new ForbiddenException('Cuenta inactiva');

    // Validar que la empresa esté activa (solo si el usuario pertenece a una empresa)
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
    if (!isValid) throw new UnauthorizedException('Contraseña incorreta');

    const usuarioCompleto = await this.obtenerUsuarioActual(user.id);
    if (!usuarioCompleto)
      throw new NotFoundException('Error al obtener datos del usuario');

    const payload: { sub: number; rol: string; empresaId: number | null } = {
      sub: user.id,
      rol: user.rol as unknown as string,
      empresaId: user.empresaId ?? null,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessExpiresInSec,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id },
      { expiresIn: this.refreshExpiresInSec },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.prisma.refreshToken.create({
      data: { token: refreshToken, usuarioId: user.id, expiresAt },
    });

    return { accessToken, refreshToken, usuario: usuarioCompleto };
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        usuario: {
          include: { empresa: true }
        }
      },
    });
    if (!stored) throw new UnauthorizedException('Refresh token inválido');
    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = stored.usuario;

    // Validar que el usuario esté activo
    if (user.estado !== 'ACTIVO') {
      throw new ForbiddenException('Cuenta inactiva');
    }

    // Validar que la empresa esté activa (solo si el usuario pertenece a una empresa y no es ADMIN_SISTEMA)
    if (user.rol !== 'ADMIN_SISTEMA' && user.empresaId && user.empresa?.estado !== 'ACTIVO') {
      throw new ForbiddenException('La empresa está inactiva. Contacte con soporte.');
    }

    const payload: { sub: number; rol: string; empresaId: number | null } = {
      sub: user.id,
      rol: user.rol as unknown as string,
      empresaId: user.empresaId ?? null,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessExpiresInSec,
    });
    const newRefreshToken = await this.jwt.signAsync(
      { sub: user.id },
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
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        celular: true,
        telefono: true,
        empresaId: true,
        estado: true,
        permisos: true, // Incluir permisos
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            nombreComercial: true,
            direccion: true,
            logo: true,
            esAgenteRetencion: true,
            tipoEmpresa: true,
            rubroId: true,
            rubro: true,
            slugTienda: true,
            ruc: true,
            plan: {
              select: {
                tieneTienda: true,
              },
            },
          },
        },
      },
    });

    // Parsear permisos de JSON a array
    if (usuario && usuario.permisos) {
      try {
        (usuario as any).permisos = JSON.parse(usuario.permisos);
      } catch (error) {
        console.error('Error parsing permissions:', error);
        (usuario as any).permisos = [];
      }
    }

    return usuario;
  }

  async obtenerPerfilCompleto(userId: number) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        celular: true,
        telefono: true,
        empresaId: true,
        estado: true,
        permisos: true, // Incluir permisos
        empresa: {
          select: {
            id: true,
            razonSocial: true,
            nombreComercial: true,
            direccion: true,
            logo: true,
            esAgenteRetencion: true,
            ruc: true,
            fechaActivacion: true,
            fechaExpiracion: true,
            tipoEmpresa: true,
            rubroId: true,
            departamento: true,
            provincia: true,
            distrito: true,
            rubro: {
              select: {
                id: true,
                nombre: true,
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
          },
        },
      },
    });

    // Parsear permisos de JSON a array
    if (usuario && usuario.permisos) {
      try {
        (usuario as any).permisos = JSON.parse(usuario.permisos);
      } catch (error) {
        console.error('Error parsing permissions:', error);
        (usuario as any).permisos = [];
      }
    }

    return usuario;
  }
}
