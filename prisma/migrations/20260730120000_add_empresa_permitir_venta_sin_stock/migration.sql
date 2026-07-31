-- AlterTable
ALTER TABLE "Empresa"
ADD COLUMN IF NOT EXISTS "permitirVentaSinStock" BOOLEAN NOT NULL DEFAULT false;
