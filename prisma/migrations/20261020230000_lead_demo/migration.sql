-- AlterEnum
ALTER TYPE "TipoDisparoLead" ADD VALUE 'SEGUIMIENTO_DEMO';

-- CreateTable
CREATE TABLE "LeadDemo" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "conversacionId" INTEGER,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "celular" TEXT,
    "correo" TEXT,
    "ruc" TEXT,
    "razonSocial" TEXT,
    "nombreComercial" TEXT,
    "rubro" TEXT,
    "demo" TEXT NOT NULL,
    "aproximada" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDemo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadDemo_empresaId_telefono_key" ON "LeadDemo"("empresaId", "telefono");

-- CreateIndex
CREATE INDEX "LeadDemo_empresaId_creadoEn_idx" ON "LeadDemo"("empresaId", "creadoEn");

-- AddForeignKey
ALTER TABLE "LeadDemo" ADD CONSTRAINT "LeadDemo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
