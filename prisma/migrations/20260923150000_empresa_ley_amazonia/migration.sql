-- Ley de Amazonía (Ley 27037): marca las empresas en zona exonerada del IGV,
-- para agregarles la leyenda 2000 del Catálogo 52 en sus comprobantes.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "leyAmazonia" BOOLEAN NOT NULL DEFAULT false;
