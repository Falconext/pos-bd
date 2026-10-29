-- Takiy: WhatsApp por QR del número del negocio.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "takiyAppKey" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "takiyAuthKey" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "takiyActivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "takiyEnviarComprobante" BOOLEAN NOT NULL DEFAULT false;

-- Mensaje propio para "llegó a la agencia" (solo cuando sale por Takiy).
ALTER TABLE "DespachoMensajeTemplate" ADD COLUMN IF NOT EXISTS "mensajeEnAgencia" TEXT;
