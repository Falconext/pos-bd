ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "plataforma" TEXT NOT NULL DEFAULT 'falconext';

UPDATE "Plan"
SET "plataforma" = 'falconext'
WHERE "plataforma" IS NULL;

DROP INDEX IF EXISTS "Plan_nombre_key";
DROP INDEX IF EXISTS "Plan_nombre_plataforma_producto_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_nombre_plataforma_producto_key"
ON "Plan"("nombre", "plataforma", "producto");

CREATE INDEX IF NOT EXISTS "Plan_plataforma_idx" ON "Plan"("plataforma");
CREATE INDEX IF NOT EXISTS "Plan_plataforma_producto_idx" ON "Plan"("plataforma", "producto");
