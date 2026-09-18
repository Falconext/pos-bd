-- Criterio del IGV en el Análisis Financiero (2026-09-18).
-- Tras el deploy (db push crea Empresa.criterioIgvVentas con default ELECTRONICOS),
-- dejar en TODOS a las empresas que pidieron "valor venta = total ÷ 1.18 en todo":
--   71 = Chocolatería y más (BORDA CASQUINA)   74 = INPRA INDUSTRIAL E.I.R.L.
UPDATE "Empresa" SET "criterioIgvVentas" = 'TODOS' WHERE id IN (71, 74);
