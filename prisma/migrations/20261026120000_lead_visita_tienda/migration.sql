-- CreateEnum
CREATE TYPE "EstadoVisitaTienda" AS ENUM ('AGENDADA', 'VINO', 'NO_VINO', 'CANCELADA');

-- CreateTable
CREATE TABLE "LeadVisitaTienda" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT,
    "cuando" TEXT,
    "fecha" DATE,
    "comprobanteId" INTEGER,
    "estado" "EstadoVisitaTienda" NOT NULL DEFAULT 'AGENDADA',
    "indicacionesEn" TIMESTAMP(3),
    "recordatorioEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadVisitaTienda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadVisitaTienda_conversacionId_key" ON "LeadVisitaTienda"("conversacionId");

-- CreateIndex
CREATE INDEX "LeadVisitaTienda_empresaId_fecha_idx" ON "LeadVisitaTienda"("empresaId", "fecha");

-- AddForeignKey
ALTER TABLE "LeadVisitaTienda" ADD CONSTRAINT "LeadVisitaTienda_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "LeadConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

