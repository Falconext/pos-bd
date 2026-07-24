-- Anticipos SUNAT en comprobante: monto total y referencias JSON.
ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "mtoAnticipos" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "anticipos" JSONB;
