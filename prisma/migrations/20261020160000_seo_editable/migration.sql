-- SEO editable por tienda y por producto (todo opcional: vacío = automático).
ALTER TABLE "Empresa"
  ADD COLUMN IF NOT EXISTS "seoTitulo" TEXT,
  ADD COLUMN IF NOT EXISTS "seoDescripcion" TEXT,
  ADD COLUMN IF NOT EXISTS "seoImagenUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "googleVerificacion" TEXT;

ALTER TABLE "Producto"
  ADD COLUMN IF NOT EXISTS "seoTitulo" TEXT,
  ADD COLUMN IF NOT EXISTS "seoDescripcion" TEXT,
  ADD COLUMN IF NOT EXISTS "seoPalabraClave" TEXT;
