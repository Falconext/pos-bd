-- Permiso fino por usuario: permite anular/eliminar comprobantes sin dar el
-- rol completo ADMIN_EMPRESA. Default false = comportamiento actual (solo
-- ADMIN_EMPRESA puede anular/eliminar), sin backfill necesario.
-- Idempotente: prod aplica el schema con `db push`, pero se deja la migración
-- para los entornos que usan `migrate deploy`.
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "puedeAnularComprobantes" BOOLEAN NOT NULL DEFAULT false;
