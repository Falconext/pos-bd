-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "tieneGestionLotes" BOOLEAN NOT NULL DEFAULT false;

-- Activate for NEGOCIO and CORPORATIVO plans
UPDATE "Plan" SET "tieneGestionLotes" = true WHERE nombre IN ('NEGOCIO', 'CORPORATIVO');
