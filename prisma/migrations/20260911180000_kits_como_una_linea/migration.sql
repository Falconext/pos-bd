-- Kits (combos) como una sola línea en el punto de venta.
-- Idempotente: prod aplica el schema con `db push`, pero se deja la migración
-- para los entornos que usan `migrate deploy`.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "kitsComoUnaLinea" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DetalleComprobante" ADD COLUMN IF NOT EXISTS "comboId" INTEGER;
CREATE INDEX IF NOT EXISTS "DetalleComprobante_comboId_idx" ON "DetalleComprobante"("comboId");
DO $$ BEGIN
  ALTER TABLE "DetalleComprobante"
    ADD CONSTRAINT "DetalleComprobante_comboId_fkey"
    FOREIGN KEY ("comboId") REFERENCES "combos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
