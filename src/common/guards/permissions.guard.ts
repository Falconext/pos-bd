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
    const raw = this.reflector.getAllAndOverride<string | string[]>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Varios códigos = basta con uno (alias del mismo módulo).
    const required = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
    if (required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    if (user.rol === 'ADMIN_SISTEMA' || user.rol === 'ADMIN_EMPRESA') {
      return true;
    }

    if (user.rol === 'USUARIO_EMPRESA') {
      const permisos: string[] = Array.isArray(user.permisos)
        ? user.permisos
        : [];
      if (permisos.includes('*') || required.some((r) => permisos.includes(r)))
        return true;
    }

    throw new ForbiddenException(
      `No tienes el permiso requerido: ${required[0]}`,
    );
  }
}
