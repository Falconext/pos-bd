-- Avisos por webhook de las ventas de la API de Krezka
-- AlterTable
ALTER TABLE "VentaApi" ADD COLUMN     "estadoAvisado" TEXT,
ADD COLUMN     "intentosAviso" INTEGER NOT NULL DEFAULT 0;
