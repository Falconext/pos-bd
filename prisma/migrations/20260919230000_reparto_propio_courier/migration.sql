-- Reparto propio / motorizado externo: campos que pide la plantilla de carga
-- masiva del courier de última milla (tipo de venta, distrito, coordenadas,
-- forma de pago del cobro en destino, revisar producto).
-- Idempotente: prod aplica el schema con `db push`; la migración queda para los
-- entornos que usan `migrate deploy`.
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "tipoVentaReparto" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "distritoUbigeo" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "distrito" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "coordenadas" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "formaPagoCobro" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "revisarProducto" BOOLEAN NOT NULL DEFAULT false;
