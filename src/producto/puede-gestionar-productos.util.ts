import { ForbiddenException } from '@nestjs/common';

/**
 * Dar de alta o borrar productos del inventario.
 *
 * Pedido de un minimarket: "para que la cajera no tenga opción de quitar o
 * agregar producto en el inventario". Es el alta y la baja del catálogo, no
 * editar lo que ya existe ni vender: la cajera sigue trabajando igual.
 *
 * Es una RESTRICCIÓN (default false = como siempre), así que los usuarios que
 * ya existen no cambian de comportamiento al desplegar.
 *
 * ADMIN_EMPRESA no se restringe nunca; si no, el admin podría dejarse a sí
 * mismo sin forma de administrar su propio catálogo. `JwtStrategy` relee la
 * bandera en cada request, así que el cambio del admin aplica al toque.
 */
export function verificarPuedeCrearOEliminarProductos(user: {
  rol?: string;
  bloquearCrearEliminarProductos?: boolean;
}) {
  if (user?.rol !== 'USUARIO_EMPRESA') return;
  if (user?.bloquearCrearEliminarProductos) {
    throw new ForbiddenException(
      'No tienes permiso para agregar ni eliminar productos del inventario. Pídele a tu administrador que te lo habilite en Usuarios.',
    );
  }
}
