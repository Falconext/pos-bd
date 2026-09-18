-- Compras en dólares · paso 4 (2026-09-18): el costo de los productos (costoPromedio)
-- pasa a estar SIEMPRE EN SOLES. Los productos en USD que ya tenían un costo
-- cargado a mano en dólares se convierten UNA vez con el TC acordado.
--
-- Uso:  psql "$DATABASE_URL" -v tc=3.368 -f migrar-costos-usd-a-soles.sql
-- (tc = soles por dólar; por defecto usar el TC venta SUNAT del día de la migración)
--
-- Productos afectados en prod al 18/09/2026 (moneda USD con costo > 0):
--   8096  REPRESENTACIONES FORKLIFT (30)  ALTERNADOR 12V 45 AMP           costo 190.0000
--   8180  REPRESENTACIONES FORKLIFT (30)  reparación pistón hidráulico    costo 300.0000
--   23858 REPRESENTACIONES FORKLIFT (30)  UNIDAD HIDRÁULICA 220V WINNER   costo 668.6441
--   23890 INPRA INDUSTRIAL (74)           POLIPASTO CD1 3 TON             costo 1027.5400
-- Sus movimientos de kardex con costo en USD ya están netos (compra anulada), no se tocan.
BEGIN;
CREATE TEMP TABLE _costos_usd_backup AS
  SELECT id, "empresaId", codigo, "costoPromedio" AS costo_usd, now() AS migrado_en
  FROM "Producto"
  WHERE moneda = 'USD' AND "costoPromedio" > 0;

UPDATE "Producto"
SET "costoPromedio" = round("costoPromedio" * :tc, 4)
WHERE moneda = 'USD' AND "costoPromedio" > 0;

SELECT b.id, b."empresaId", b.codigo, b.costo_usd::numeric(12,4) AS costo_usd,
       p."costoPromedio"::numeric(12,4) AS costo_soles
FROM _costos_usd_backup b JOIN "Producto" p ON p.id = b.id
ORDER BY b."empresaId", b.id;
COMMIT;
