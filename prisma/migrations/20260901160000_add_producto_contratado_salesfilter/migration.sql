-- Producto contratado por la empresa (MYPE master) + id espejo en SalesFilter.
-- ADITIVA: no rompe datos existentes (default TODO_EN_UNO para las empresas ya creadas).

-- CreateEnum
CREATE TYPE "ProductoContratado" AS ENUM ('SOLO_VENTAS', 'TODO_EN_UNO', 'AMBOS');

-- AlterTable
ALTER TABLE "Empresa"
  ADD COLUMN "productoContratado" "ProductoContratado" NOT NULL DEFAULT 'TODO_EN_UNO',
  ADD COLUMN "salesfilterUserId" TEXT;
