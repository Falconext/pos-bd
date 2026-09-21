-- Tamaño de paquete por defecto (empresa) y tamaño/flete cotizado por despacho (idempotente).
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "shalomTamanoDefault" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "shalomTamano" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "shalomFleteCotizado" DOUBLE PRECISION;
