-- Memoria de imágenes aprobadas por empresa para autocompletado IA
CREATE TABLE "ImagenProductoAprobadaIa" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "claveBusqueda" TEXT NOT NULL,
    "nombreNorm" TEXT NOT NULL,
    "marcaNorm" TEXT,
    "categoriaNorm" TEXT,
    "imagenUrl" TEXT NOT NULL,
    "vecesUsada" INTEGER NOT NULL DEFAULT 1,
    "ultimoUsoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImagenProductoAprobadaIa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImagenProductoAprobadaIa_empresaId_claveBusqueda_key"
  ON "ImagenProductoAprobadaIa"("empresaId", "claveBusqueda");

CREATE INDEX "ImagenProductoAprobadaIa_empresaId_nombreNorm_marcaNorm_catego_idx"
  ON "ImagenProductoAprobadaIa"("empresaId", "nombreNorm", "marcaNorm", "categoriaNorm");

CREATE INDEX "ImagenProductoAprobadaIa_empresaId_ultimoUsoEn_idx"
  ON "ImagenProductoAprobadaIa"("empresaId", "ultimoUsoEn");

ALTER TABLE "ImagenProductoAprobadaIa"
  ADD CONSTRAINT "ImagenProductoAprobadaIa_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
