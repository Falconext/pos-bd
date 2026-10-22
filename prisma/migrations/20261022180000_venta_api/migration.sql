-- Ventas que llegan por la API de Krezka desde la web del negocio
-- CreateTable
CREATE TABLE "VentaApi" (
    "id" TEXT NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "comprobanteId" INTEGER NOT NULL,
    "externalId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VentaApi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VentaApi_comprobanteId_key" ON "VentaApi"("comprobanteId");

-- CreateIndex
CREATE INDEX "VentaApi_empresaId_creadoEn_idx" ON "VentaApi"("empresaId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "VentaApi_empresaId_externalId_key" ON "VentaApi"("empresaId", "externalId");

