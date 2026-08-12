-- Gastos operativos en moneda extranjera (USD/PEN) + medio de pago / cuenta bancaria.
-- Ej: pagos a Google/Amazon/Shopify en dólares por transferencia bancaria.
ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "moneda" TEXT NOT NULL DEFAULT 'PEN';
ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "tipoCambio" DECIMAL(10,4);
ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "cuentaBancariaId" INTEGER;
ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "medioPago" TEXT;

DO $$ BEGIN
  ALTER TABLE "GastoOperativo"
    ADD CONSTRAINT "GastoOperativo_cuentaBancariaId_fkey"
    FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
