-- AlterTable
ALTER TABLE "Plan"
ADD COLUMN IF NOT EXISTS "tieneGestionComisiones" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the previous behavior: commissions were available to corporate plans.
UPDATE "Plan"
SET "tieneGestionComisiones" = true
WHERE UPPER("nombre") LIKE '%CORPORAT%';
