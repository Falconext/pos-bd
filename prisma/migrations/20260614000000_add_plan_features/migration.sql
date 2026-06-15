CREATE TABLE IF NOT EXISTS "PlanFeature" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlanFeature_planId_featureKey_key" ON "PlanFeature"("planId", "featureKey");
CREATE INDEX IF NOT EXISTS "PlanFeature_planId_idx" ON "PlanFeature"("planId");
CREATE INDEX IF NOT EXISTS "PlanFeature_featureKey_idx" ON "PlanFeature"("featureKey");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'PlanFeature_planId_fkey'
    ) THEN
        ALTER TABLE "PlanFeature"
        ADD CONSTRAINT "PlanFeature_planId_fkey"
        FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'esPrueba', "esPrueba", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneTienda', "tieneTienda", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneBanners', "tieneBanners", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneGaleria', "tieneGaleria", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneCulqi', "tieneCulqi", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneDeliveryGPS', "tieneDeliveryGPS", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneTicketera', "tieneTicketera", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneGestionLotes', "tieneGestionLotes", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;

INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "updatedAt")
SELECT id, 'tieneGestionProvisiones', "tieneGestionProvisiones", CURRENT_TIMESTAMP FROM "Plan"
ON CONFLICT ("planId", "featureKey") DO NOTHING;
