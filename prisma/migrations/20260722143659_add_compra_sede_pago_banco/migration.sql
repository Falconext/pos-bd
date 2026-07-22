-- Pago por banco en compras: cuenta bancaria usada (referencia = N° de operación).
ALTER TABLE "PagoCompra" ADD COLUMN IF NOT EXISTS "cuentaBancariaId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "PagoCompra"
    ADD CONSTRAINT "PagoCompra_cuentaBancariaId_fkey"
    FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
