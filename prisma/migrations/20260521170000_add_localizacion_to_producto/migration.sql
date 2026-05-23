-- Add optional warehouse/store location per product
ALTER TABLE "Producto"
ADD COLUMN "localizacion" TEXT;
