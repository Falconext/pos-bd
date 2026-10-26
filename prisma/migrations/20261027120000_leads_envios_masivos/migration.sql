-- Envíos masivos (fase 4): el envío y su vínculo con cada destinatario en LeadDisparo.
-- AlterEnum
ALTER TYPE "TipoDisparoLead" ADD VALUE 'ENVIO_MASIVO';

-- AlterTable
ALTER TABLE "LeadDisparo" ADD COLUMN     "envioMasivoId" INTEGER,
ADD COLUMN     "wamid" TEXT;

-- CreateTable
CREATE TABLE "LeadEnvioMasivo" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "segmentoId" INTEGER,
    "filtrosJson" JSONB NOT NULL,
    "plantillaId" INTEGER,
    "plantillaJson" JSONB NOT NULL,
    "valoresJson" JSONB,
    "estado" TEXT NOT NULL DEFAULT 'PROGRAMADO',
    "programadoPara" TIMESTAMP(3) NOT NULL,
    "porMinuto" INTEGER NOT NULL DEFAULT 30,
    "totalDestinatarios" INTEGER NOT NULL DEFAULT 0,
    "nota" TEXT,
    "creadoPorId" INTEGER,
    "iniciadoEn" TIMESTAMP(3),
    "terminadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadEnvioMasivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadEnvioMasivo_empresaId_creadoEn_idx" ON "LeadEnvioMasivo"("empresaId", "creadoEn");

-- CreateIndex
CREATE INDEX "LeadEnvioMasivo_estado_programadoPara_idx" ON "LeadEnvioMasivo"("estado", "programadoPara");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDisparo_wamid_key" ON "LeadDisparo"("wamid");

-- CreateIndex
CREATE INDEX "LeadDisparo_envioMasivoId_estado_idx" ON "LeadDisparo"("envioMasivoId", "estado");

-- AddForeignKey
ALTER TABLE "LeadEnvioMasivo" ADD CONSTRAINT "LeadEnvioMasivo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

