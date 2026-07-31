-- CreateTable
CREATE TABLE "producto_codigos_barras" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producto_codigos_barras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producto_codigos_barras_productoId_idx" ON "producto_codigos_barras"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "producto_codigos_barras_empresaId_codigo_key" ON "producto_codigos_barras"("empresaId", "codigo");

-- AddForeignKey
ALTER TABLE "producto_codigos_barras" ADD CONSTRAINT "producto_codigos_barras_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
