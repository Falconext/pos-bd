-- ============================================================
-- MIGRACIÓN SEGURA V4: Quoted Identifiers Correctos
-- ============================================================
-- Corregido: Usa "Rubro" (con comillas) porque Postgres es case-sensitive
-- con identificadores quoted.
-- ============================================================

-- 1. Agregar nuevos rubros (Insertar solo si no existen)
INSERT INTO "Rubro" (nombre)
SELECT v.nombre
FROM (VALUES 
  ('Farmacia'),
  ('Botica'),
  ('Bodega y Abarrotes'),
  ('Supermarket'),
  ('Minimarket'),
  ('Ferretería'),
  ('Panadería y Pastelería'),
  ('Librería y Papelería'),
  ('Farmacia Veterinaria')
) AS v(nombre)
WHERE NOT EXISTS (
  SELECT 1 FROM "Rubro" r WHERE r.nombre = v.nombre
);

-- 2. Actualizar nombre de rubro existente 
UPDATE "Rubro" 
SET nombre = 'Restaurante y alimentos'
WHERE nombre = 'Restauración y alimentos'
AND NOT EXISTS (
  SELECT 1 FROM "Rubro" WHERE nombre = 'Restaurante y alimentos'
);
