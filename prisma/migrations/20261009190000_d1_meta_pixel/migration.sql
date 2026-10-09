-- D1: Pixel de Meta por empresa.
-- Sin él, las campañas pagadas no saben qué anuncio trajo la venta.
ALTER TABLE "Empresa" ADD COLUMN "metaPixelId" TEXT;
