DO $$ BEGIN
  CREATE TYPE "EstadoProductoSerie" AS ENUM ('DISPONIBLE', 'VENDIDO', 'RESERVADO', 'BAJA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "DetalleComprobante" ADD COLUMN IF NOT EXISTS "numerosSerie" JSONB;

CREATE TABLE IF NOT EXISTS "ProductoSerie" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "productoId" INTEGER NOT NULL,
  "sedeId" INTEGER,
  "numeroSerie" TEXT NOT NULL,
  "estado" "EstadoProductoSerie" NOT NULL DEFAULT 'DISPONIBLE',
  "garantiaMeses" INTEGER,
  "garantiaHasta" TIMESTAMP(3),
  "comprobanteId" INTEGER,
  "detalleComprobanteId" INTEGER,
  "observacion" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductoSerie_empresaId_numeroSerie_key"
  ON "ProductoSerie"("empresaId", "numeroSerie");

CREATE INDEX IF NOT EXISTS "ProductoSerie_empresaId_productoId_estado_idx"
  ON "ProductoSerie"("empresaId", "productoId", "estado");

CREATE INDEX IF NOT EXISTS "ProductoSerie_comprobanteId_idx"
  ON "ProductoSerie"("comprobanteId");

CREATE INDEX IF NOT EXISTS "ProductoSerie_detalleComprobanteId_idx"
  ON "ProductoSerie"("detalleComprobanteId");

DO $$ BEGIN
  ALTER TABLE "ProductoSerie"
    ADD CONSTRAINT "ProductoSerie_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductoSerie"
    ADD CONSTRAINT "ProductoSerie_productoId_fkey"
    FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductoSerie"
    ADD CONSTRAINT "ProductoSerie_sedeId_fkey"
    FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductoSerie"
    ADD CONSTRAINT "ProductoSerie_comprobanteId_fkey"
    FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductoSerie"
    ADD CONSTRAINT "ProductoSerie_detalleComprobanteId_fkey"
    FOREIGN KEY ("detalleComprobanteId") REFERENCES "DetalleComprobante"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
