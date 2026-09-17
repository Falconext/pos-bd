-- Distribución de una compra entre sedes: cada línea (DetalleCompra) puede
-- indicar la sede/almacén al que entra su stock. null = sede de la cabecera
-- (comportamiento previo), así que no hace falta backfill.
-- Idempotente: prod aplica el schema con `db push`; la migración queda para los
-- entornos que usan `migrate deploy`.
ALTER TABLE "DetalleCompra" ADD COLUMN IF NOT EXISTS "sedeId" INTEGER;
CREATE INDEX IF NOT EXISTS "DetalleCompra_sedeId_idx" ON "DetalleCompra"("sedeId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DetalleCompra_sedeId_fkey') THEN
    ALTER TABLE "DetalleCompra" ADD CONSTRAINT "DetalleCompra_sedeId_fkey"
      FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
