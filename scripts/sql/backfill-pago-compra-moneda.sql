-- Compras en dólares (2026-09-18): PagoCompra.moneda / tipoCambio / montoSoles / diferenciaCambio.
-- Ejecutar UNA vez en producción después del `prisma db push` que agrega las columnas.
-- Los pagos existentes se toman "al TC de la compra": misma moneda que su compra,
-- montoSoles = monto × TC de la compra (1 si es en soles) y sin diferencia de cambio.
UPDATE "PagoCompra" p
SET moneda = c.moneda,
    "tipoCambio" = CASE WHEN c.moneda = 'USD' THEN COALESCE(c."tipoCambio", 1) ELSE 1 END,
    "montoSoles" = p.monto * (CASE WHEN c.moneda = 'USD' THEN COALESCE(c."tipoCambio", 1) ELSE 1 END),
    "diferenciaCambio" = 0
FROM "Compra" c
WHERE c.id = p."compraId"
  AND p."montoSoles" IS NULL;
