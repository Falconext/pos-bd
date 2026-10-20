-- Resumen diario de stock bajo por correo/WhatsApp (apagado por defecto).
ALTER TABLE "Empresa"
  ADD COLUMN IF NOT EXISTS "alertaStockCorreo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "alertaStockWhatsapp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "alertaStockCorreos" TEXT,
  ADD COLUMN IF NOT EXISTS "alertaStockCelular" TEXT,
  ADD COLUMN IF NOT EXISTS "alertaStockUltimoEnvio" TIMESTAMP(3);
