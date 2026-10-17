-- Historial de reprecios masivos, para poder deshacerlos.
--
-- La pantalla cambia el precio de cientos de productos de una vez. Sin este
-- registro, equivocarse de lista o de porcentaje no tiene vuelta atrás: habría
-- que recordar a mano cuánto valía cada producto antes.
--
-- Tabla nueva y aislada: no toca ninguna existente ni ningún dato.
CREATE TABLE "ReprecioLote" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "listaPrecioId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "operacion" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "valor" DECIMAL(12,4) NOT NULL,
    "detalle" JSONB NOT NULL,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertidoEn" TIMESTAMP(3),
    CONSTRAINT "ReprecioLote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReprecioLote_empresaId_creadoEn_idx" ON "ReprecioLote"("empresaId", "creadoEn");
CREATE INDEX "ReprecioLote_listaPrecioId_idx" ON "ReprecioLote"("listaPrecioId");
ALTER TABLE "ReprecioLote" ADD CONSTRAINT "ReprecioLote_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
