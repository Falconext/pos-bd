-- Fotos y notas de voz en el chat de soporte.
ALTER TABLE "SoporteMensaje" ADD COLUMN IF NOT EXISTS "imagenUrl" TEXT;
ALTER TABLE "SoporteMensaje" ADD COLUMN IF NOT EXISTS "audioUrl" TEXT;
