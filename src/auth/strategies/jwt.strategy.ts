import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveJwtSecret } from '../jwt-secret';

export type JwtPayload = {
  sub: number;
  rol: string;
  empresaId: number | null;
  sedeId?: number | null;
  sistemaNegocio?: string | null;
  sistemaProducto?: string | null;
  pendingSedeSelection?: boolean;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(config),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.usuario.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        rol: true,
        estado: true,
        empresaId: true,
        permisos: true,
        sistemaNegocio: true,
        sistemaProducto: true,
        bloquearEdicionPrecioVenta: true,
        ocultarPrecioCosto: true,
        ocultarPedidosEcommerce: true,
        convertirEnSupervisor: true,
        noPermitirVentaProductosGratuitos: true,
        restringirTransferenciasASuSede: true,
        empresa: {
          select: {
            estado: true,
            fechaExpiracion: true,
          },
        },
      },
    });

    if (!user || user.estado !== 'ACTIVO') {
      throw new UnauthorizedException('Sesion invalida');
    }

    const isSystemUser =
      user.rol === 'ADMIN_SISTEMA' || user.rol === 'RESELLER';
    if (!isSystemUser && user.empresaId) {
      if (!user.empresa || user.empresa.estado !== 'ACTIVO') {
        throw new UnauthorizedException('Empresa inactiva');
      }
      if (user.empresa.fechaExpiracion < new Date()) {
        throw new UnauthorizedException('Plan vencido');
      }
    }

    // permisos se guarda como JSON string (ej. '["*"]' o '["usuarios",...]').
    // Lo normalizamos a string[] para que los guards por permiso lo consuman.
    let permisos: string[] = [];
    if (Array.isArray(user.permisos)) {
      permisos = user.permisos as string[];
    } else if (typeof user.permisos === 'string' && user.permisos.trim()) {
      try {
        const parsed = JSON.parse(user.permisos);
        if (Array.isArray(parsed)) permisos = parsed;
      } catch {
        permisos = [];
      }
    }

    return {
      id: user.id,
      rol: user.rol,
      empresaId: user.empresaId ?? null,
      permisos,
      sedeId: payload.sedeId ?? null,
      sistemaNegocio: user.sistemaNegocio ?? payload.sistemaNegocio ?? null,
      sistemaProducto: user.sistemaProducto ?? payload.sistemaProducto ?? null,
      // Permisos finos por usuario (multi-local/minimarket) — se re-consultan
      // en cada request, así que un cambio del admin aplica sin esperar a que
      // expire el token.
      bloquearEdicionPrecioVenta: user.bloquearEdicionPrecioVenta,
      ocultarPrecioCosto: user.ocultarPrecioCosto,
      ocultarPedidosEcommerce: user.ocultarPedidosEcommerce,
      convertirEnSupervisor: user.convertirEnSupervisor,
      noPermitirVentaProductosGratuitos: user.noPermitirVentaProductosGratuitos,
      restringirTransferenciasASuSede: user.restringirTransferenciasASuSede,
      // Token temporal de selección de sede: el guard lo rechaza en todos los
      // endpoints salvo /auth/select-sede (marcado con @AllowPendingSede).
      pendingSedeSelection: payload.pendingSedeSelection === true,
    };
  }
}
