-- CreateEnum TipoGuiaRemision (idempotent: skips if already exists in production)
DO $$ BEGIN
    CREATE TYPE "TipoGuiaRemision" AS ENUM ('REMITENTE', 'TRANSPORTISTA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable GuiaRemision: add tipoGuia column (IF NOT EXISTS for production where column may already exist)
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "tipoGuia" "TipoGuiaRemision" NOT NULL DEFAULT 'REMITENTE';

-- Update existing rows: series starting with V = TRANSPORTISTA
UPDATE "GuiaRemision"
SET "tipoGuia" = 'TRANSPORTISTA'
WHERE "serie" LIKE 'V%';

-- Update tipoDocumento to match tipoGuia: TRANSPORTISTA = 31
UPDATE "GuiaRemision"
SET "tipoDocumento" = '31'
WHERE "tipoGuia" = 'TRANSPORTISTA';
