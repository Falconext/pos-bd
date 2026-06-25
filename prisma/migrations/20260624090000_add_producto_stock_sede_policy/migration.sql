ALTER TABLE "ProductoStock"
ADD COLUMN IF NOT EXISTS "visibleEnSede" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "vendibleEnSede" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "precioUnitarioOverride" DECIMAL(65,30),
ADD COLUMN IF NOT EXISTS "precioOfertaOverride" DECIMAL(65,30);

UPDATE "ProductoStock"
SET
  "visibleEnSede" = COALESCE("visibleEnSede", true),
  "vendibleEnSede" = COALESCE("vendibleEnSede", true);
