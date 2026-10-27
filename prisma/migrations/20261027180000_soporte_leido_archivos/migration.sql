-- Chat de soporte: hasta cuándo leyó cada lado (doble check) y documentos adjuntos.
ALTER TABLE "SoporteConversacion" ADD COLUMN IF NOT EXISTS "leidoPorEmpresaEn" TIMESTAMP(3);
ALTER TABLE "SoporteConversacion" ADD COLUMN IF NOT EXISTS "leidoPorSistemaEn" TIMESTAMP(3);
ALTER TABLE "SoporteMensaje" ADD COLUMN IF NOT EXISTS "archivoUrl" TEXT;
ALTER TABLE "SoporteMensaje" ADD COLUMN IF NOT EXISTS "archivoNombre" TEXT;
