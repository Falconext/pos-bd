-- Cambia el default de publicarEnTienda a true y publica todos los productos activos existentes
ALTER TABLE "Producto" ALTER COLUMN "publicarEnTienda" SET DEFAULT true;

UPDATE "Producto" SET "publicarEnTienda" = true WHERE "publicarEnTienda" = false AND "estado" = 'ACTIVO';
