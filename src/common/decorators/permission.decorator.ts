import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

/**
 * Exige que el usuario tenga un permiso fino concreto (ej. 'usuarios').
 * A diferencia de @Roles, permite el acceso a un USUARIO_EMPRESA cuyo
 * `permisos` incluya el código pedido (o '*'). ADMIN_EMPRESA y ADMIN_SISTEMA
 * lo tienen siempre. Se valida con PermissionsGuard.
 */
export const RequiresPermission = (permiso: string) =>
  SetMetadata(PERMISSION_KEY, permiso);
