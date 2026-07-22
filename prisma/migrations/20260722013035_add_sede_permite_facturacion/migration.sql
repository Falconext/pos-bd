-- Habilita facturación en sedes tipo ALMACEN (opt-in por sede).
-- Idempotente: la columna puede existir ya vía db push.
ALTER TABLE "Sede" ADD COLUMN IF NOT EXISTS "permiteFacturacion" BOOLEAN NOT NULL DEFAULT false;
