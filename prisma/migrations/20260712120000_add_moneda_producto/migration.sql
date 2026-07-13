-- AlterTable: agrega moneda al Producto ("PEN" soles / "USD" dólares).
-- Al facturar, los productos en USD se convierten a soles con el TC del día.
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "moneda" TEXT NOT NULL DEFAULT 'PEN';
