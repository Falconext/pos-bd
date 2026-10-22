-- De qué anuncio de Facebook/Instagram llegó cada cliente por WhatsApp
CREATE TABLE "LeadAnuncioOrigen" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "anuncioId" TEXT NOT NULL,
    "tipo" TEXT,
    "titulo" TEXT,
    "texto" TEXT,
    "url" TEXT,
    "imagenUrl" TEXT,
    "ctwaClid" TEXT,
    "whatsappMsgId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAnuncioOrigen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadAnuncioOrigen_whatsappMsgId_key" ON "LeadAnuncioOrigen"("whatsappMsgId");
CREATE INDEX "LeadAnuncioOrigen_empresaId_creadoEn_idx" ON "LeadAnuncioOrigen"("empresaId", "creadoEn");
CREATE INDEX "LeadAnuncioOrigen_conversacionId_idx" ON "LeadAnuncioOrigen"("conversacionId");

ALTER TABLE "LeadAnuncioOrigen" ADD CONSTRAINT "LeadAnuncioOrigen_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "LeadConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
