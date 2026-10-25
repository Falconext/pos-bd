-- IA de Ventas por Instagram: credenciales de la cuenta conectada y el canal
-- de cada conversación. Todo nullable o con default: no toca datos existentes.
ALTER TABLE "Empresa" ADD COLUMN "instagramAccountId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "instagramUsername" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "instagramToken" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "instagramTokenExpira" TIMESTAMP(3);
ALTER TABLE "Empresa" ADD COLUMN "instagramActivo" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Empresa_instagramAccountId_key" ON "Empresa"("instagramAccountId");
ALTER TABLE "LeadConversacion" ADD COLUMN "canal" TEXT NOT NULL DEFAULT 'WHATSAPP';
