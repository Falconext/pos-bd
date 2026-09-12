-- Código interno del negocio por presentación (ProductoCodigoBarras).
ALTER TABLE "producto_codigos_barras" ADD COLUMN IF NOT EXISTS "codigoInterno" TEXT;
