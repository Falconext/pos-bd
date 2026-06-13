CREATE TABLE IF NOT EXISTS "EmpresaSerie" (
    "id" SERIAL PRIMARY KEY,
    "empresaId" INTEGER NOT NULL,
    "tipoDoc" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "correlativo" INTEGER NOT NULL DEFAULT 1,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmpresaSerie_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmpresaSerie_empresaId_tipoDoc_serie_key" ON "EmpresaSerie"("empresaId", "tipoDoc", "serie");
CREATE INDEX IF NOT EXISTS "EmpresaSerie_empresaId_tipoDoc_activo_idx" ON "EmpresaSerie"("empresaId", "tipoDoc", "activo");
