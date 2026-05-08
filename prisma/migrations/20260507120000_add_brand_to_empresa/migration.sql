-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN "brand" TEXT NOT NULL DEFAULT 'falconext';
ALTER TABLE "Empresa" ADD COLUMN "usuarioPse" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "contrasenaPse" TEXT;

-- CreateIndex
CREATE INDEX "Empresa_brand_idx" ON "Empresa"("brand");
