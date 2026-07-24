-- Factura de exportación: monto de operaciones de exportación (afectación 40).
ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "mtoOperExportacion" DOUBLE PRECISION NOT NULL DEFAULT 0;
