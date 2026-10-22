-- Entradas y salidas de mercadería en documentos numerados (NE/NS)
-- CreateEnum
CREATE TYPE "TipoDocumentoInventario" AS ENUM ('ENTRADA', 'SALIDA');

-- CreateTable
CREATE TABLE "DocumentoInventario" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "sedeId" INTEGER NOT NULL,
    "tipo" "TipoDocumentoInventario" NOT NULL,
    "numero" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "detalle" TEXT,
    "usuarioId" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoInventarioItem" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costoUnitario" DECIMAL(65,30),
    "lote" TEXT,
    "fechaVencimiento" TIMESTAMP(3),
    "movimientoKardexId" INTEGER,

    CONSTRAINT "DocumentoInventarioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentoInventario_empresaId_fecha_idx" ON "DocumentoInventario"("empresaId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoInventario_empresaId_tipo_numero_key" ON "DocumentoInventario"("empresaId", "tipo", "numero");

-- CreateIndex
CREATE INDEX "DocumentoInventarioItem_documentoId_idx" ON "DocumentoInventarioItem"("documentoId");

-- CreateIndex
CREATE INDEX "DocumentoInventarioItem_productoId_idx" ON "DocumentoInventarioItem"("productoId");

-- AddForeignKey
ALTER TABLE "DocumentoInventarioItem" ADD CONSTRAINT "DocumentoInventarioItem_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoInventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoInventarioItem" ADD CONSTRAINT "DocumentoInventarioItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

