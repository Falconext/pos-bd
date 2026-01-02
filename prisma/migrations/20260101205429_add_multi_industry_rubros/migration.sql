-- ============================================================
-- MIGRACIÓN SEGURA V2: Agregar Rubros Multi-Industria
-- ============================================================
-- Corregido para no depender de constraints UNIQUE
-- Usa INSERT ... SELECT ... WHERE NOT EXISTS
-- ============================================================

-- 1. Agregar nuevos rubros (Verificando existencia manualmente)
INSERT INTO rubros (nombre)
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
  SELECT 1 FROM rubros r WHERE r.nombre = v.nombre
);

-- 2. Actualizar nombre de rubro existente (solo si existe)
UPDATE rubros 
SET nombre = 'Restaurante y alimentos'
WHERE nombre = 'Restauración y alimentos';
