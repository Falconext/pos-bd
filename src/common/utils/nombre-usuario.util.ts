/**
 * El nombre de un usuario, para dejarlo escrito en una auditoría.
 *
 * Hace falta porque el token NO lo lleva: la estrategia JWT selecciona rol,
 * permisos y banderas, pero no el nombre. Quien escriba `user.nombre` en un
 * controlador recibe `undefined`, y si eso cae en un campo de auditoría
 * termina guardando "bot" o "usuario 29" donde debería decir quién fue.
 *
 * Es una lectura por acción auditada, no por request: solo se llama al
 * registrar el movimiento.
 */
export async function nombreDeUsuario(
  prisma: { usuario: { findUnique: (a: unknown) => Promise<unknown> } },
  usuarioId?: number | null,
): Promise<string | null> {
  if (!usuarioId) return null;
  try {
    const u = (await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nombre: true },
    })) as { nombre?: string | null } | null;
    return u?.nombre?.trim() || null;
  } catch {
    return null;
  }
}

/** Lo que se escribe en la auditoría: el nombre, o el id si no se pudo leer. */
export function etiquetaDeUsuario(
  nombre?: string | null,
  usuarioId?: number | null,
): string {
  return nombre?.trim() || (usuarioId ? `usuario #${usuarioId}` : 'sistema');
}
