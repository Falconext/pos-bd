-- Bloque 2 de la guía de remisión: fecha de entrega al transportista,
-- vehículos y conductores secundarios, autorización especial del vehículo y
-- código de producto SUNAT por ítem.
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "fechaEntregaBienes" TIMESTAMP(3);
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "vehiculoNroAutorizacion" TEXT;
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "vehiculoEntidadEmisora" TEXT;
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "vehiculosSecundarios" JSONB;
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "conductoresSecundarios" JSONB;
ALTER TABLE "DetalleGuiaRemision" ADD COLUMN IF NOT EXISTS "codigoProductoSunat" TEXT;
