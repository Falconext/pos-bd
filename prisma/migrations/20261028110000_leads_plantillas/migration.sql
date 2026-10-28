-- Plantillas de WhatsApp propias de la empresa (envíos masivos, fase 3).
-- CreateTable
CREATE TABLE "LeadPlantilla" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "nombreMeta" TEXT NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'MARKETING',
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "cabeceraTipo" TEXT NOT NULL DEFAULT 'NINGUNA',
    "cabeceraTexto" TEXT,
    "cabeceraImagenUrl" TEXT,
    "cuerpo" TEXT NOT NULL,
    "pie" TEXT,
    "botonesJson" JSONB,
    "ejemplosJson" JSONB,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "motivoRechazo" TEXT,
    "metaId" TEXT,
    "enviadaEn" TIMESTAMP(3),
    "revisadaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPlantilla_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadPlantilla_empresaId_estado_idx" ON "LeadPlantilla"("empresaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPlantilla_empresaId_nombreMeta_key" ON "LeadPlantilla"("empresaId", "nombreMeta");

-- AddForeignKey
ALTER TABLE "LeadPlantilla" ADD CONSTRAINT "LeadPlantilla_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

