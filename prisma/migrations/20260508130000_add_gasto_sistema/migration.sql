-- CreateTable
CREATE TABLE IF NOT EXISTS "GastoSistema" (
    "id"           SERIAL NOT NULL,
    "concepto"     TEXT NOT NULL,
    "categoria"    TEXT NOT NULL,
    "monto"        DECIMAL(65,30) NOT NULL,
    "fecha"        TIMESTAMP(3) NOT NULL,
    "descripcion"  TEXT,
    "recurrente"   BOOLEAN NOT NULL DEFAULT false,
    "periodicidad" TEXT,
    "creadoEn"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GastoSistema_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GastoSistema_fecha_idx" ON "GastoSistema"("fecha");
CREATE INDEX IF NOT EXISTS "GastoSistema_categoria_idx" ON "GastoSistema"("categoria");
