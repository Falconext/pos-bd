-- Módulo IA de Ventas / Filtro de Leads (portado de salesfilter-ai).
-- Migración ADITIVA: crea las tablas del CRM de leads y agrega el toggle +
-- contexto de IA a Empresa. No modifica ni elimina nada existente, por lo que
-- MYPE sigue facturando y despachando durante y después de aplicarla.

-- CreateEnum
CREATE TYPE "EstadoLeadConversacion" AS ENUM ('ACTIVA', 'CALIFICADA', 'CERRADA', 'TRANSFERIDA');

-- CreateEnum
CREATE TYPE "EstadoLeadProspecto" AS ENUM ('FRIO', 'TIBIO', 'CALIENTE', 'CONVERTIDO', 'PERDIDO');

-- CreateEnum
CREATE TYPE "RolLeadMensaje" AS ENUM ('USUARIO', 'ASISTENTE', 'SISTEMA');

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "iaVentasActiva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "iaVentasContexto" TEXT;

-- CreateTable
CREATE TABLE "LeadConversacion" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "telefonoProspecto" TEXT NOT NULL,
    "nombreProspecto" TEXT,
    "estado" "EstadoLeadConversacion" NOT NULL DEFAULT 'ACTIVA',
    "cantidadMensajes" INTEGER NOT NULL DEFAULT 0,
    "numeroWhatsappId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadConversacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMensaje" (
    "id" SERIAL NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "rol" "RolLeadMensaje" NOT NULL,
    "contenido" TEXT NOT NULL,
    "whatsappMsgId" TEXT,
    "esAudio" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadMensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadProspecto" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "telefonoProspecto" TEXT NOT NULL,
    "nombreProspecto" TEXT,
    "puntaje" INTEGER NOT NULL DEFAULT 0,
    "estado" "EstadoLeadProspecto" NOT NULL DEFAULT 'FRIO',
    "presupuesto" INTEGER,
    "autoridad" INTEGER,
    "necesidad" INTEGER,
    "plazo" INTEGER,
    "resumen" TEXT,
    "puntosClave" TEXT[],
    "proximaAccion" TEXT,
    "botActivo" BOOLEAN NOT NULL DEFAULT true,
    "notificadoEn" TIMESTAMP(3),
    "conversacionId" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadProspecto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadConversacion_empresaId_estado_idx" ON "LeadConversacion"("empresaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "LeadConversacion_empresaId_telefonoProspecto_key" ON "LeadConversacion"("empresaId", "telefonoProspecto");

-- CreateIndex
CREATE UNIQUE INDEX "LeadMensaje_whatsappMsgId_key" ON "LeadMensaje"("whatsappMsgId");

-- CreateIndex
CREATE INDEX "LeadMensaje_conversacionId_idx" ON "LeadMensaje"("conversacionId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadProspecto_conversacionId_key" ON "LeadProspecto"("conversacionId");

-- CreateIndex
CREATE INDEX "LeadProspecto_empresaId_estado_idx" ON "LeadProspecto"("empresaId", "estado");

-- CreateIndex
CREATE INDEX "LeadProspecto_empresaId_puntaje_idx" ON "LeadProspecto"("empresaId", "puntaje");

-- AddForeignKey
ALTER TABLE "LeadConversacion" ADD CONSTRAINT "LeadConversacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMensaje" ADD CONSTRAINT "LeadMensaje_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "LeadConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadProspecto" ADD CONSTRAINT "LeadProspecto_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "LeadConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadProspecto" ADD CONSTRAINT "LeadProspecto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
