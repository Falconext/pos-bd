-- Create enum if not exists
DO $$ BEGIN
    CREATE TYPE "CategoriaGasto" AS ENUM ('PUBLICIDAD', 'SUELDOS', 'ENVIOS', 'COMISIONES', 'ALQUILER', 'OTROS', 'PERSONALIZADA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create table if not exists (was created outside Prisma migrations)
CREATE TABLE IF NOT EXISTS "GastoOperativo" (
    "id"           SERIAL PRIMARY KEY,
    "empresaId"    INTEGER NOT NULL,
    "mes"          INTEGER NOT NULL,
    "anio"         INTEGER NOT NULL,
    "fecha"        TIMESTAMP(3),
    "recurrenteDiario" BOOLEAN NOT NULL DEFAULT false,
    "fechaInicio"  TIMESTAMP(3),
    "fechaFin"     TIMESTAMP(3),
    "categoria"    "CategoriaGasto" NOT NULL,
    "etiqueta"     TEXT,
    "monto"        DECIMAL(12,2) NOT NULL,
    "descripcion"  TEXT,
    "creadoEn"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GastoOperativo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Add column if running against existing DB that already has the table without this column
ALTER TABLE "GastoOperativo" ADD COLUMN IF NOT EXISTS "fecha" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "GastoOperativo_empresaId_fecha_idx" ON "GastoOperativo"("empresaId", "fecha");
