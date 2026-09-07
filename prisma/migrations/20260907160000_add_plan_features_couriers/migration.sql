-- Couriers y plantillas de WhatsApp como características del plan.
--
-- Hasta ahora el corte estaba clavado en código: `nombrePlan.includes('CORPORAT')`
-- para crear guías y `/negocio|corporativo/` para el rastreo. Esto lo pasa a la
-- tabla PlanFeature para que se administre desde Sistema → Planes.
--
-- El backfill reproduce EXACTAMENTE el comportamiento de hoy, así que ningún
-- cliente gana ni pierde acceso al desplegar; a partir de aquí se cambia con los
-- interruptores, sin tocar código.
--   · rastreo (Shalom/Olva)      -> planes Negocio y Corporativo
--   · crear guías (Shalom/Olva)  -> solo Corporativo
--   · plantillas de WhatsApp     -> todos los planes (hoy no estaba limitado)
INSERT INTO "PlanFeature" ("planId", "featureKey", "enabled", "createdAt", "updatedAt")
SELECT p.id, f."featureKey",
       CASE
         WHEN f."featureKey" IN ('tieneShalomGuias', 'tieneOlvaGuias')
           THEN UPPER(p.nombre) LIKE '%CORPORAT%'
         WHEN f."featureKey" IN ('tieneShalom', 'tieneOlva')
           THEN UPPER(p.nombre) LIKE '%CORPORAT%' OR UPPER(p.nombre) LIKE '%NEGOCIO%'
         ELSE TRUE
       END,
       NOW(), NOW()
FROM "Plan" p
CROSS JOIN (VALUES
  ('tieneShalom'), ('tieneShalomGuias'),
  ('tieneOlva'), ('tieneOlvaGuias'),
  ('tienePlantillasWhatsApp')
) AS f("featureKey")
ON CONFLICT ("planId", "featureKey") DO NOTHING;
