-- Egreso de caja originado por el pago en efectivo de una compra (trazabilidad).
ALTER TABLE "MovimientoCaja" ADD COLUMN IF NOT EXISTS "compraId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "MovimientoCaja"
    ADD CONSTRAINT "MovimientoCaja_compraId_fkey"
    FOREIGN KEY ("compraId") REFERENCES "Compra"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
