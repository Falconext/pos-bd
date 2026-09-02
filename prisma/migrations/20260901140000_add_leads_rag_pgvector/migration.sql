-- RAG del módulo de leads: pgvector + documentos de entrenamiento. ADITIVA.
-- Requiere permiso para crear la extensión (Railway/Neon lo permiten al owner).

-- Extensión pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "TipoLeadDocumento" AS ENUM ('TEXTO', 'URL', 'PDF');

-- CreateEnum
CREATE TYPE "EstadoLeadDocumento" AS ENUM ('PENDIENTE', 'INDEXADO', 'ERROR');

-- CreateTable
CREATE TABLE "LeadDocumento" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "tipo" "TipoLeadDocumento" NOT NULL,
    "titulo" TEXT NOT NULL,
    "origen" TEXT,
    "contenido" TEXT NOT NULL,
    "estado" "EstadoLeadDocumento" NOT NULL DEFAULT 'PENDIENTE',
    "error" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFragmento" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "indice" INTEGER NOT NULL,
    "contenido" TEXT NOT NULL,
    "embedding" vector(768),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFragmento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadDocumento_empresaId_idx" ON "LeadDocumento"("empresaId");

-- CreateIndex
CREATE INDEX "LeadFragmento_documentoId_idx" ON "LeadFragmento"("documentoId");

-- AddForeignKey
ALTER TABLE "LeadDocumento" ADD CONSTRAINT "LeadDocumento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFragmento" ADD CONSTRAINT "LeadFragmento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "LeadDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
