import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';

/**
 * Autoriza por permiso fino de usuario, reflejando la lógica del frontend
 * (`hasPermission`): ADMIN_SISTEMA y ADMIN_EMPRESA siempre pasan; un
 * USUARIO_EMPRESA pasa si su `permisos` incluye '*' o el código exigido.
 * Requiere que JwtStrategy exponga `user.permisos` como string[].
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    if (user.rol === 'ADMIN_SISTEMA' || user.rol === 'ADMIN_EMPRESA') {
      return true;
    }

    if (user.rol === 'USUARIO_EMPRESA') {
      const permisos: string[] = Array.isArray(user.permisos)
        ? user.permisos
        : [];
      if (permisos.includes('*') || permisos.includes(required)) return true;
    }

    throw new ForbiddenException(
      `No tienes el permiso requerido: ${required}`,
    );
  }
}
