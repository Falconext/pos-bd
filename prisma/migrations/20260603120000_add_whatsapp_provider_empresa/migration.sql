DO $$ BEGIN
  CREATE TYPE "WhatsAppProvider" AS ENUM ('PLATFORM', 'EMPRESA', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Empresa"
  ADD COLUMN IF NOT EXISTS "whatsappProvider" "WhatsAppProvider" NOT NULL DEFAULT 'PLATFORM',
  ADD COLUMN IF NOT EXISTS "whatsappApiToken" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappPhoneNumberId" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappBusinessId" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappActivo" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Empresa_whatsappProvider_idx" ON "Empresa"("whatsappProvider");
