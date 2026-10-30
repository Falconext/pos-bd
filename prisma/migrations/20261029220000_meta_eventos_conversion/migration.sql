-- CreateTable
CREATE TABLE "MetaEventoConversion" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "comprobanteId" INTEGER,
    "wabaId" TEXT NOT NULL,
    "ctwaClid" TEXT NOT NULL,
    "valor" DECIMAL(12,2),
    "moneda" TEXT,
    "ocurridoEn" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaEventoConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaEventoConversion_empresaId_clave_key" ON "MetaEventoConversion"("empresaId", "clave");

-- CreateIndex
CREATE INDEX "MetaEventoConversion_empresaId_creadoEn_idx" ON "MetaEventoConversion"("empresaId", "creadoEn");

-- CreateIndex
CREATE INDEX "MetaEventoConversion_estado_idx" ON "MetaEventoConversion"("estado");
