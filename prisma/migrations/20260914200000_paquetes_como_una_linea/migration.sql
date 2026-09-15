-- Paquetes (ProductoCodigoBarras.unidadesPorPaquete) como una sola línea en el
-- punto de venta, análogo a kitsComoUnaLinea pero para el mismo producto.
-- Idempotente: prod aplica el schema con `db push`, pero se deja la migración
-- para los entornos que usan `migrate deploy`.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "paquetesComoUnaLinea" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DetalleComprobante" ADD COLUMN IF NOT EXISTS "unidadesPorPaquete" INTEGER;
