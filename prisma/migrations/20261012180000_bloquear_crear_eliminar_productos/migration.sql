-- Permiso fino: la cajera no puede dar de alta ni borrar productos.
-- Default false = exactamente el comportamiento anterior, así que los usuarios
-- que ya existen no necesitan backfill.
ALTER TABLE "Usuario"
  ADD COLUMN IF NOT EXISTS "bloquearCrearEliminarProductos" BOOLEAN NOT NULL DEFAULT false;
