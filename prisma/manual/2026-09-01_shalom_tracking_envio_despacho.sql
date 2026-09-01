-- Auto-actualización de estado Shalom (read-through cache + scheduler).
-- Columnas de tracking en EnvioDespacho. Idempotente: seguro de correr varias veces.
-- El deploy de producción (Dockerfile) ya las aplica vía `prisma db push`; este
-- script sirve para aplicarlas a mano ANTES del deploy si se desea de-riesgar.
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "shalomEstado"       TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "shalomEntregado"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "shalomTrackingJson" JSONB;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "shalomOseId"        TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN IF NOT EXISTS "shalomSyncAt"       TIMESTAMP(3);
