-- Add retry tracking columns to GuiaRemision (mirrors Comprobante retry pattern)
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "sunatRetriesCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "sunatNextRetryAt" TIMESTAMP(3);
ALTER TABLE "GuiaRemision" ADD COLUMN IF NOT EXISTS "sunatLastRetryAt" TIMESTAMP(3);
