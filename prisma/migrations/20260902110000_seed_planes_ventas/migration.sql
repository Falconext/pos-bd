-- Crea los planes de IA de Ventas (Ventas Start/Pro/Scale + Full) para las
-- plataformas falconext y krezka. Se ejecuta UNA vez en el deploy (migrate deploy).
-- Idempotente (ON CONFLICT DO NOTHING) por si se corre sobre datos existentes.

-- 1) Asegurar el módulo 'leads' (IA de Ventas)
INSERT INTO "Modulo" (codigo, producto, nombre, descripcion, icono, orden, activo)
VALUES ('leads', 'facturacion', 'IA de Ventas',
        'Asesor por WhatsApp que califica prospectos (BANT) y avisa leads calientes',
        'solar:chat-round-dots-bold-duotone', 13, true)
ON CONFLICT (codigo, producto) DO NOTHING;

-- 2) Planes (Ventas = producto 'ventas'; Full = producto 'full')
INSERT INTO "Plan" (nombre, plataforma, producto, costo, "maxLeadsMes", descripcion, "duracionDias")
VALUES
  ('Ventas Start', 'falconext', 'ventas', 149, 500,  'IA de Ventas por WhatsApp — hasta 500 leads/mes', 30),
  ('Ventas Pro',   'falconext', 'ventas', 249, 1500, 'IA de Ventas por WhatsApp — hasta 1,500 leads/mes', 30),
  ('Ventas Scale', 'falconext', 'ventas', 399, 5000, 'IA de Ventas por WhatsApp — hasta 5,000 leads/mes', 30),
  ('Full',         'falconext', 'full',   299, 1500, 'Todo Falconext (facturación completa) + IA de Ventas (1,500 leads/mes)', 30),
  ('Ventas Start', 'krezka',    'ventas', 149, 500,  'IA de Ventas por WhatsApp — hasta 500 leads/mes', 30),
  ('Ventas Pro',   'krezka',    'ventas', 249, 1500, 'IA de Ventas por WhatsApp — hasta 1,500 leads/mes', 30),
  ('Ventas Scale', 'krezka',    'ventas', 399, 5000, 'IA de Ventas por WhatsApp — hasta 5,000 leads/mes', 30),
  ('Full',         'krezka',    'full',   299, 1500, 'Todo (facturación completa) + IA de Ventas (1,500 leads/mes)', 30)
ON CONFLICT (nombre, plataforma, producto) DO NOTHING;

-- 3) Planes Ventas → solo el módulo 'leads'
INSERT INTO "PlanModulo" ("planId", "moduloId")
SELECT p.id, m.id
FROM "Plan" p
JOIN "Modulo" m ON m.codigo = 'leads' AND m.producto = 'facturacion'
WHERE p.producto = 'ventas' AND p.nombre IN ('Ventas Start','Ventas Pro','Ventas Scale')
ON CONFLICT ("planId", "moduloId") DO NOTHING;

-- 4) Plan Full → TODOS los módulos de producto 'facturacion' (incluye leads)
INSERT INTO "PlanModulo" ("planId", "moduloId")
SELECT p.id, m.id
FROM "Plan" p
JOIN "Modulo" m ON m.producto = 'facturacion'
WHERE p.producto = 'full' AND p.nombre = 'Full'
ON CONFLICT ("planId", "moduloId") DO NOTHING;
