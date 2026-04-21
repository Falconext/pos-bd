-- Backfill de datos base para empresas creadas por reseller
-- Idempotente: puede ejecutarse varias veces sin duplicar productos ni cliente activo por defecto.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "TipoDocumento" WHERE "codigo" = '1') THEN
        RAISE EXCEPTION 'No existe TipoDocumento código 1 (DNI).';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM "UnidadMedida") THEN
        RAISE EXCEPTION 'No existen registros en UnidadMedida.';
    END IF;
END $$;

-- 1) Activar CLIENTES VARIOS existente (si estaba inactivo) en empresas reseller
WITH reseller_empresas AS (
    SELECT "id"
    FROM "Empresa"
    WHERE "resellerId" IS NOT NULL
),
tipo_dni AS (
    SELECT "id"
    FROM "TipoDocumento"
    WHERE "codigo" = '1'
    LIMIT 1
)
UPDATE "Cliente" c
SET
    "estado" = 'ACTIVO',
    "persona" = 'CLIENTE',
    "tipoDocumentoId" = COALESCE(c."tipoDocumentoId", td."id")
FROM tipo_dni td
WHERE c."empresaId" IN (SELECT "id" FROM reseller_empresas)
  AND c."nombre" = 'CLIENTES VARIOS'
  AND c."estado" <> 'ACTIVO';

-- 2) Crear CLIENTES VARIOS activo donde no exista
WITH reseller_empresas AS (
    SELECT "id"
    FROM "Empresa"
    WHERE "resellerId" IS NOT NULL
),
tipo_dni AS (
    SELECT "id"
    FROM "TipoDocumento"
    WHERE "codigo" = '1'
    LIMIT 1
)
INSERT INTO "Cliente" (
    "nombre",
    "nroDoc",
    "direccion",
    "empresaId",
    "tipoDocumentoId",
    "persona",
    "estado"
)
SELECT
    'CLIENTES VARIOS',
    '10000000',
    '-',
    re."id",
    td."id",
    'CLIENTE',
    'ACTIVO'
FROM reseller_empresas re
CROSS JOIN tipo_dni td
WHERE NOT EXISTS (
    SELECT 1
    FROM "Cliente" c
    WHERE c."empresaId" = re."id"
      AND c."nombre" = 'CLIENTES VARIOS'
      AND c."estado" = 'ACTIVO'
);

-- 3) Crear productos base (DGD, IPM, PLD) donde falten
WITH reseller_empresas AS (
    SELECT "id"
    FROM "Empresa"
    WHERE "resellerId" IS NOT NULL
),
unidad_base AS (
    SELECT "id"
    FROM "UnidadMedida"
    ORDER BY "id"
    LIMIT 1
),
productos_base AS (
    SELECT *
    FROM (VALUES
        ('DGD', 'Descuento global'),
        ('IPM', 'Interes por mora'),
        ('PLD', 'Penalidad')
    ) AS t("codigo", "descripcion")
)
INSERT INTO "Producto" (
    "codigo",
    "descripcion",
    "unidadMedidaId",
    "tipoAfectacionIGV",
    "precioUnitario",
    "valorUnitario",
    "igvPorcentaje",
    "stock",
    "estado",
    "empresaId"
)
SELECT
    pb."codigo",
    pb."descripcion",
    ub."id",
    '10',
    0,
    0,
    0,
    0,
    'INACTIVO',
    re."id"
FROM reseller_empresas re
CROSS JOIN unidad_base ub
CROSS JOIN productos_base pb
ON CONFLICT ("empresaId", "codigo") DO NOTHING;

COMMIT;
