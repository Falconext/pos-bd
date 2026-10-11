-- AlterTable
ALTER TABLE "LeadConsulta" ADD COLUMN     "avisadoEn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LeadConsulta_empresaId_avisadoEn_idx" ON "LeadConsulta"("empresaId", "avisadoEn");

