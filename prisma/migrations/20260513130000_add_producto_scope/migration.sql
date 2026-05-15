ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "producto" TEXT NOT NULL DEFAULT 'facturacion';
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "sistemaProducto" TEXT;

CREATE INDEX IF NOT EXISTS "Empresa_producto_idx" ON "Empresa"("producto");
CREATE INDEX IF NOT EXISTS "Empresa_brand_producto_idx" ON "Empresa"("brand", "producto");
