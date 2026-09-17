-- Modo offline-first de la app móvil (Fase 1).
-- Idempotente: prod aplica el schema con `db push`; la migración queda para los
-- entornos que usan `migrate deploy`.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "offlineHabilitado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "origenSyncUuid" TEXT;
CREATE INDEX IF NOT EXISTS "Comprobante_origenSyncUuid_idx" ON "Comprobante"("origenSyncUuid");
ALTER TABLE "MovimientoCaja" ADD COLUMN IF NOT EXISTS "origenSyncUuid" TEXT;
ALTER TABLE "MovimientoKardex" ADD COLUMN IF NOT EXISTS "origenSyncUuid" TEXT;

CREATE TABLE IF NOT EXISTS "OperacionSync" (
  "id" SERIAL PRIMARY KEY,
  "uuid" TEXT NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "sedeId" INTEGER,
  "dispositivoId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "realizadoEn" TIMESTAMP(3) NOT NULL,
  "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "estado" TEXT NOT NULL,
  "resultado" JSONB,
  "error" TEXT,
  "payloadHash" TEXT NOT NULL,
  CONSTRAINT "OperacionSync_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperacionSync_uuid_key" ON "OperacionSync"("uuid");
CREATE INDEX IF NOT EXISTS "OperacionSync_empresaId_dispositivoId_recibidoEn_idx" ON "OperacionSync"("empresaId", "dispositivoId", "recibidoEn");
CREATE INDEX IF NOT EXISTS "OperacionSync_empresaId_estado_idx" ON "OperacionSync"("empresaId", "estado");

CREATE TABLE IF NOT EXISTS "DispositivoMovil" (
  "id" TEXT PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "nombre" TEXT,
  "plataforma" TEXT,
  "appVersion" TEXT,
  "ultimoSyncEn" TIMESTAMP(3),
  "ultimoCatalogoVersion" TEXT,
  "pendientesReportados" INTEGER NOT NULL DEFAULT 0,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispositivoMovil_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DispositivoMovil_empresaId_ultimoSyncEn_idx" ON "DispositivoMovil"("empresaId", "ultimoSyncEn");
