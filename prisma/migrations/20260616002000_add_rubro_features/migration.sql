CREATE TABLE IF NOT EXISTS "RubroFeature" (
  "id" SERIAL PRIMARY KEY,
  "rubroId" INTEGER NOT NULL,
  "featureKey" TEXT NOT NULL,
  "enabledByDefault" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "RubroFeature_rubroId_featureKey_key"
  ON "RubroFeature"("rubroId", "featureKey");

CREATE INDEX IF NOT EXISTS "RubroFeature_featureKey_idx"
  ON "RubroFeature"("featureKey");

DO $$ BEGIN
  ALTER TABLE "RubroFeature"
    ADD CONSTRAINT "RubroFeature_rubroId_fkey"
    FOREIGN KEY ("rubroId") REFERENCES "Rubro"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "Rubro" ("nombre")
VALUES ('Ventas de accesorios y repuestos de cómputo')
ON CONFLICT ("nombre") DO NOTHING;

WITH matched AS (
  SELECT id, nombre FROM "Rubro"
  WHERE lower(nombre) ~ '(cómputo|computo|computadora|informática|informatica|tecnología|tecnologia|repuesto|accesorio|hardware|laptop|(^| )pc( |$))'
), features(feature_key) AS (
  VALUES
    ('fichaTecnicaComputo'),
    ('controlSeriesGarantia'),
    ('usaCodigoBarras'),
    ('controlStock')
)
INSERT INTO "RubroFeature" ("rubroId", "featureKey", "enabledByDefault")
SELECT matched.id, features.feature_key, true
FROM matched CROSS JOIN features
ON CONFLICT ("rubroId", "featureKey") DO UPDATE
SET "enabledByDefault" = EXCLUDED."enabledByDefault";

WITH matched AS (
  SELECT id, nombre FROM "Rubro"
  WHERE lower(nombre) ~ '(farmacia|botica|droguería|drogueria)'
), features(feature_key) AS (
  VALUES
    ('gestionLotes'),
    ('requiereVencimientos'),
    ('permiteFraccionamiento'),
    ('controlStock')
)
INSERT INTO "RubroFeature" ("rubroId", "featureKey", "enabledByDefault")
SELECT matched.id, features.feature_key, true
FROM matched CROSS JOIN features
ON CONFLICT ("rubroId", "featureKey") DO UPDATE
SET "enabledByDefault" = EXCLUDED."enabledByDefault";

WITH matched AS (
  SELECT id, nombre FROM "Rubro"
  WHERE lower(nombre) ~ '(fabricación|fabricacion|manufactura|industria|producción|produccion)'
), features(feature_key) AS (
  VALUES
    ('gestionLotes'),
    ('controlStock')
)
INSERT INTO "RubroFeature" ("rubroId", "featureKey", "enabledByDefault")
SELECT matched.id, features.feature_key, true
FROM matched CROSS JOIN features
ON CONFLICT ("rubroId", "featureKey") DO UPDATE
SET "enabledByDefault" = EXCLUDED."enabledByDefault";

WITH matched AS (
  SELECT id, nombre FROM "Rubro"
  WHERE lower(nombre) ~ '(bodega|supermarket|supermercado|minimarket|abarrotes)'
), features(feature_key) AS (
  VALUES
    ('usaCodigoBarras'),
    ('gestionOfertas'),
    ('controlStock')
)
INSERT INTO "RubroFeature" ("rubroId", "featureKey", "enabledByDefault")
SELECT matched.id, features.feature_key, true
FROM matched CROSS JOIN features
ON CONFLICT ("rubroId", "featureKey") DO UPDATE
SET "enabledByDefault" = EXCLUDED."enabledByDefault";
