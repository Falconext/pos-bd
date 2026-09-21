-- Claves de retiro propias del negocio para las guías Shalom (idempotente).
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "shalomClavesRetiro" TEXT;
