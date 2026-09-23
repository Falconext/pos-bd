-- Revisión del contador sobre cada compra (SIRE/RCE): aprobada, denegada o pendiente.
DO $$ BEGIN
  CREATE TYPE "EstadoContador" AS ENUM ('PENDIENTE', 'APROBADA', 'DENEGADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Compra" ADD COLUMN IF NOT EXISTS "estadoContador" "EstadoContador" NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE "Compra" ADD COLUMN IF NOT EXISTS "motivoContador" TEXT;
ALTER TABLE "Compra" ADD COLUMN IF NOT EXISTS "revisadoContadorEn" TIMESTAMP(3);
ALTER TABLE "Compra" ADD COLUMN IF NOT EXISTS "revisadoContadorPor" INTEGER;
