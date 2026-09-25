-- Pasarelas de pago por empresa: cada comerciante cobra a SU cuenta.
-- Antes Culqi usaba llaves globales y el dinero de todas las tiendas entraba a
-- una sola cuenta.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "culqiPublicKey" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "culqiSecretKey" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "culqiActivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "niubizMerchantId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "niubizUsuario" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "niubizPassword" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "niubizActivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "pasarelasUsaDemo" BOOLEAN NOT NULL DEFAULT true;
