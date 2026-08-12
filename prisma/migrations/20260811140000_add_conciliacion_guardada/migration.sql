-- Historial de conciliaciones bancarias guardadas (persistencia por empresa).
-- Guarda el resultado completo del cruce para poder re-visualizarlo luego.
CREATE TABLE IF NOT EXISTS "ConciliacionBancariaGuardada" (
  "id" SERIAL NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "usuarioId" INTEGER,
  "fechaInicio" TEXT,
  "fechaFin" TEXT,
  "observaciones" TEXT,
  "resumen" JSONB NOT NULL,
  "resultado" JSONB NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConciliacionBancariaGuardada_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ConciliacionBancariaGuardada"
    ADD CONSTRAINT "ConciliacionBancariaGuardada_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ConciliacionBancariaGuardada_empresaId_creadoEn_idx"
  ON "ConciliacionBancariaGuardada" ("empresaId", "creadoEn");
