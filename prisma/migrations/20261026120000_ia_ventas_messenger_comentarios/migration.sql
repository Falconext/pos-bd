-- IA de Ventas: aviso de reconexión de Instagram, respuestas a comentarios y
-- Messenger. Todo nullable o con default: no toca datos existentes.
ALTER TABLE "Empresa" ADD COLUMN "instagramErrorToken" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "instagramComentarios" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN "instagramComentariosClave" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "facebookPageId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "facebookPageNombre" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "facebookPageToken" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "facebookActivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN "facebookErrorToken" TEXT;
CREATE UNIQUE INDEX "Empresa_facebookPageId_key" ON "Empresa"("facebookPageId");
ALTER TABLE "LeadConversacion" ADD COLUMN "igComentarioId" TEXT;
ALTER TABLE "LeadConversacion" ADD COLUMN "igComentarioRespondido" BOOLEAN NOT NULL DEFAULT false;
