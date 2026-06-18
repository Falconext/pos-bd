CREATE TABLE IF NOT EXISTS "FichaTecnicaPlantilla" (
  "id" SERIAL PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "descripcion" TEXT,
  "rubroId" INTEGER,
  "categoriaId" INTEGER,
  "empresaId" INTEGER,
  "campos" JSONB NOT NULL,
  "destacados" JSONB,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "FichaTecnicaPlantilla_rubroId_idx" ON "FichaTecnicaPlantilla"("rubroId");
CREATE INDEX IF NOT EXISTS "FichaTecnicaPlantilla_categoriaId_idx" ON "FichaTecnicaPlantilla"("categoriaId");
CREATE INDEX IF NOT EXISTS "FichaTecnicaPlantilla_empresaId_idx" ON "FichaTecnicaPlantilla"("empresaId");
CREATE INDEX IF NOT EXISTS "FichaTecnicaPlantilla_activo_idx" ON "FichaTecnicaPlantilla"("activo");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FichaTecnicaPlantilla_rubroId_fkey'
  ) THEN
    ALTER TABLE "FichaTecnicaPlantilla"
      ADD CONSTRAINT "FichaTecnicaPlantilla_rubroId_fkey"
      FOREIGN KEY ("rubroId") REFERENCES "Rubro"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FichaTecnicaPlantilla_categoriaId_fkey'
  ) THEN
    ALTER TABLE "FichaTecnicaPlantilla"
      ADD CONSTRAINT "FichaTecnicaPlantilla_categoriaId_fkey"
      FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FichaTecnicaPlantilla_empresaId_fkey'
  ) THEN
    ALTER TABLE "FichaTecnicaPlantilla"
      ADD CONSTRAINT "FichaTecnicaPlantilla_empresaId_fkey"
      FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "FichaTecnicaPlantilla" ("nombre", "descripcion", "rubroId", "campos", "destacados")
SELECT
  'Cómputo - Mouse y periféricos',
  'Ficha técnica base para mouse, periféricos y accesorios de cómputo.',
  r."id",
  '[
    {"key":"marca","label":"Marca","grupo":"Características generales","tipo":"texto","orden":1},
    {"key":"linea","label":"Línea","grupo":"Características generales","tipo":"texto","orden":2},
    {"key":"modelo","label":"Modelo","grupo":"Características generales","tipo":"texto","orden":3},
    {"key":"modeloAlfanumerico","label":"Modelo alfanumérico","grupo":"Características generales","tipo":"texto","orden":4},
    {"key":"color","label":"Color","grupo":"Características generales","tipo":"texto","orden":5},
    {"key":"tipoMouse","label":"Tipo de mouse","grupo":"Especificaciones","tipo":"texto","orden":10},
    {"key":"orientacionMano","label":"Orientación de la mano","grupo":"Especificaciones","tipo":"texto","orden":11},
    {"key":"sistemasCompatibles","label":"Sistemas operativos compatibles","grupo":"Especificaciones","tipo":"textarea","orden":12},
    {"key":"esInalambrico","label":"Es inalámbrico","grupo":"Especificaciones","tipo":"booleano","orden":13},
    {"key":"cantidadBotones","label":"Cantidad de botones","grupo":"Especificaciones","tipo":"numero","orden":14},
    {"key":"tipoSensor","label":"Tipo de sensor","grupo":"Sensor","tipo":"texto","orden":20},
    {"key":"tecnologiaSensor","label":"Tecnología del sensor","grupo":"Sensor","tipo":"texto","orden":21},
    {"key":"resolucionSensor","label":"Resolución del sensor","grupo":"Sensor","tipo":"numero","unidad":"dpi","orden":22},
    {"key":"bluetooth","label":"Con Bluetooth","grupo":"Tecnología","tipo":"booleano","orden":30},
    {"key":"conCable","label":"Con cable","grupo":"Otros","tipo":"booleano","orden":40},
    {"key":"conLuces","label":"Con luces","grupo":"Otros","tipo":"booleano","orden":41},
    {"key":"accesoriosIncluidos","label":"Accesorios incluidos","grupo":"Otros","tipo":"texto","orden":42},
    {"key":"largo","label":"Largo","grupo":"Peso y dimensiones","tipo":"numero","unidad":"cm","orden":50},
    {"key":"ancho","label":"Ancho","grupo":"Peso y dimensiones","tipo":"numero","unidad":"cm","orden":51},
    {"key":"altura","label":"Altura","grupo":"Peso y dimensiones","tipo":"numero","unidad":"cm","orden":52},
    {"key":"peso","label":"Peso","grupo":"Peso y dimensiones","tipo":"numero","unidad":"g","orden":53},
    {"key":"garantiaMeses","label":"Garantía","grupo":"Garantía","tipo":"numero","unidad":"meses","orden":60}
  ]'::jsonb,
  '["tipoMouse","tipoSensor","resolucionSensor","esInalambrico"]'::jsonb
FROM "Rubro" r
WHERE (lower(r."nombre") LIKE '%comput%' OR lower(r."nombre") LIKE '%cómput%' OR lower(r."nombre") LIKE '%computo%' OR lower(r."nombre") LIKE '%cómputo%')
  AND NOT EXISTS (
    SELECT 1 FROM "FichaTecnicaPlantilla" f
    WHERE f."rubroId" = r."id" AND f."nombre" = 'Cómputo - Mouse y periféricos'
  );
