ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "recurrenteDiario" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "fechaInicio" TIMESTAMP(3);
ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "fechaFin" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "GastoOperativo_empresaId_recurrenteDiario_fechaInicio_fechaFin_idx" ON "GastoOperativo"("empresaId", "recurrenteDiario", "fechaInicio", "fechaFin");
