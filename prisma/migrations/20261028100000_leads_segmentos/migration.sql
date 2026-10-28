-- Segmentos guardados de contactos (envíos masivos, fase 2).
CREATE TABLE "LeadSegmento" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "filtrosJson" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSegmento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadSegmento_empresaId_idx" ON "LeadSegmento"("empresaId");

ALTER TABLE "LeadSegmento" ADD CONSTRAINT "LeadSegmento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
