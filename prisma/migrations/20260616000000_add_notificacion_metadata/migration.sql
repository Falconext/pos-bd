-- AlterTable: add nullable metaData JSON column to Notificacion
ALTER TABLE "Notificacion" ADD COLUMN "metaData" JSONB;
