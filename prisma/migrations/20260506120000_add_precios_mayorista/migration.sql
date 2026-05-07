-- Add preciosMayorista JSON column to Producto for wholesale pricing tiers
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "preciosMayorista" JSONB;
