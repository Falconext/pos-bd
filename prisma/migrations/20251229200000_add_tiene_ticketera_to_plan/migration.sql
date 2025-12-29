-- Add tieneTicketera column to Plan table (safe for existing data)
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "tieneTicketera" BOOLEAN NOT NULL DEFAULT false;
