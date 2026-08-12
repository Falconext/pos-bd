-- Cobranza en campo: vendedor de campo atribuido a la venta (denormalizado, sin FK).
ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "vendedorCampoId" INTEGER;
ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "vendedorCampoNombre" TEXT;
