-- POS: mantener la búsqueda al agregar (idempotente).
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "posMantenerBusqueda" BOOLEAN NOT NULL DEFAULT false;
