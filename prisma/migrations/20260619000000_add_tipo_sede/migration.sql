-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "TipoSede" AS ENUM ('PUNTO_DE_VENTA', 'ALMACEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: agregar tipo con default PUNTO_DE_VENTA si no existe ya
DO $$ BEGIN
  ALTER TABLE "Sede" ADD COLUMN "tipo" "TipoSede" NOT NULL DEFAULT 'PUNTO_DE_VENTA';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
