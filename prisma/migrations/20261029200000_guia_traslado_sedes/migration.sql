-- Ubigeo del local para la guía de traslado entre sedes (el código de anexo
-- SUNAT ya vive en Sede.codigo).
ALTER TABLE "Sede" ADD COLUMN "ubigeo" TEXT;

-- Guía de traslado entre sedes propias: qué sedes y si ya movió el stock.
ALTER TABLE "GuiaRemision"
  ADD COLUMN "sedeOrigenId" INTEGER,
  ADD COLUMN "sedeDestinoId" INTEGER,
  ADD COLUMN "stockTrasladado" BOOLEAN NOT NULL DEFAULT false;
