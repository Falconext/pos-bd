import { ForbiddenException } from '@nestjs/common';

/**
 * ADMIN_EMPRESA siempre puede anular/eliminar comprobantes. Un
 * USUARIO_EMPRESA solo si el admin le activó el permiso fino
 * `puedeAnularComprobantes` (JwtStrategy lo re-consulta en cada request, así
 * que un cambio del admin aplica al toque, sin esperar a que el usuario
 * vuelva a loguearse).
 */
export function verificarPuedeAnularComprobante(user: {
  rol: string;
  puedeAnularComprobantes?: boolean;
}) {
  if (user.rol !== 'USUARIO_EMPRESA') return;
  if (!user.puedeAnularComprobantes) {
    throw new ForbiddenException(
      'No tienes permiso para anular o eliminar comprobantes. Pídele a tu administrador que te lo active en Usuarios.',
    );
  }
}
