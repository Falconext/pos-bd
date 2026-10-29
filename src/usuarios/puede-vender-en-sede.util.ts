import { ForbiddenException } from '@nestjs/common';

/**
 * Sedes donde el usuario entra pero no vende.
 *
 * Pedido de un empresario: al vendedor se le asignan varias sedes (para ver
 * stock, cotizar o trasladar), pero solo debe emitir ventas en algunas. La
 * marca vive en `UsuarioSede.puedeVender` (default true = como siempre).
 *
 * Bloquea Boleta, Factura, Nota de venta y Ticket. Cotizaciones, notas de
 * pedido y órdenes de trabajo no son venta y siguen permitidas.
 *
 * ADMIN_EMPRESA no se restringe nunca. `JwtStrategy` relee las sedes en cada
 * request, así que el cambio del admin aplica al toque.
 */
export const TIPOS_QUE_NO_SON_VENTA = new Set(['COT', 'NP', 'OT']);

export function verificarPuedeVenderEnSede(
  user: { rol?: string; sedeId?: number | null; sedesSinVenta?: number[] },
  tipoDoc?: string,
) {
  if (user?.rol !== 'USUARIO_EMPRESA') return;
  if (tipoDoc && TIPOS_QUE_NO_SON_VENTA.has(String(tipoDoc).toUpperCase())) return;
  if (user.sedeId == null) return;
  if ((user.sedesSinVenta ?? []).includes(user.sedeId)) {
    throw new ForbiddenException(
      'No puedes vender en esta sede. Cambia a una sede donde tengas venta habilitada o pídele a tu administrador que te la habilite en Usuarios.',
    );
  }
}
