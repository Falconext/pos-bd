-- Documentos relacionados al traslado (Catálogo 61) de la guía de remisión:
-- factura/boleta que origina el envío, DAM, constancia de detracción, etc.
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "documentosRelacionados" JSONB;
