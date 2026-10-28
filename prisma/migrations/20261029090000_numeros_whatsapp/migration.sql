-- Varios números de WhatsApp por empresa.
CREATE TABLE "NumeroWhatsapp" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "token" TEXT,
    "numeroVisible" TEXT,
    "etiqueta" TEXT,
    "coexistencia" BOOLEAN NOT NULL DEFAULT false,
    "iaActiva" BOOLEAN NOT NULL DEFAULT true,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NumeroWhatsapp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NumeroWhatsapp_phoneNumberId_key" ON "NumeroWhatsapp"("phoneNumberId");
CREATE INDEX "NumeroWhatsapp_empresaId_idx" ON "NumeroWhatsapp"("empresaId");
ALTER TABLE "NumeroWhatsapp" ADD CONSTRAINT "NumeroWhatsapp_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El número que cada empresa ya tiene conectado pasa a ser su principal.
INSERT INTO "NumeroWhatsapp" ("empresaId", "phoneNumberId", "wabaId", "token", "principal")
SELECT e."id", e."whatsappPhoneNumberId", e."whatsappBusinessId", e."whatsappApiToken", true
FROM "Empresa" e
WHERE e."whatsappProvider" = 'EMPRESA'
  AND e."whatsappPhoneNumberId" IS NOT NULL
  AND e."whatsappPhoneNumberId" <> ''
ON CONFLICT ("phoneNumberId") DO NOTHING;
