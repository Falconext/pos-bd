-- AlterTable Empresa: add usaDemo column (IF NOT EXISTS, idempotent)
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "usaDemo" BOOLEAN NOT NULL DEFAULT false;
