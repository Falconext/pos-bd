-- Envíos masivos (fase 5): entregado y leído según los estados de Meta.
-- AlterTable
ALTER TABLE "LeadDisparo" ADD COLUMN     "entregadoEn" TIMESTAMP(3),
ADD COLUMN     "leidoEn" TIMESTAMP(3);

