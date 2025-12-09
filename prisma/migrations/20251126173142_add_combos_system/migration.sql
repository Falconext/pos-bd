-- AlterTable
ALTER TABLE "ItemPedidoTienda" ADD COLUMN     "comboId" INTEGER,
ADD COLUMN     "comboSnapshot" JSONB,
ADD COLUMN     "esCombo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "combos" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "descripcion" TEXT,
    "imagenUrl" VARCHAR(500),
    "precioRegular" DECIMAL(10,2) NOT NULL,
    "precioCombo" DECIMAL(10,2) NOT NULL,
    "descuentoPorcentaje" DECIMAL(5,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER,
    "fechaInicio" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_items" (
    "id" SERIAL NOT NULL,
    "comboId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combos_empresaId_activo_idx" ON "combos"("empresaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "combo_items_comboId_productoId_key" ON "combo_items"("comboId", "productoId");

-- CreateIndex
CREATE INDEX "ItemPedidoTienda_comboId_idx" ON "ItemPedidoTienda"("comboId");

-- AddForeignKey
ALTER TABLE "ItemPedidoTienda" ADD CONSTRAINT "ItemPedidoTienda_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "combos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combos" ADD CONSTRAINT "combos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
