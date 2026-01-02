-- ============================================================
-- MIGRACIÓN SEGURA V3: A prueba de fallos
-- ============================================================

-- 1. Agregar nuevos rubros (Insertar solo si no existen)
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

-- 2. Actualizar nombre de rubro existente 
-- (Solo si existe el antiguo Y NO existe ya el nuevo, para evitar error de duplicado)
UPDATE rubros 
SET nombre = 'Restaurante y alimentos'
WHERE nombre = 'Restauración y alimentos'
AND NOT EXISTS (
  SELECT 1 FROM rubros WHERE nombre = 'Restaurante y alimentos'
);

-- Si ya existen ambos (el antiguo y el nuevo), eliminamos el duplicado antiguo para limpiar
-- (Solo si no tiene empresas asociadas, por seguridad)
-- DELETE FROM rubros WHERE nombre = 'Restauración y alimentos' 
-- AND NOT EXISTS (SELECT 1 FROM empresas WHERE rubro_id = rubros.id);
