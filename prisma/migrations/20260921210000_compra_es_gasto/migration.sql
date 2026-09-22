-- Compras de consumo propio (no inventario) entran al P&L como gasto del mes.
ALTER TABLE "Compra" ADD COLUMN IF NOT EXISTS "esGasto" BOOLEAN NOT NULL DEFAULT false;
-- Backfill: una compra cuyas líneas no están enlazadas a ningún producto del
-- catálogo nunca entra al kardex, así que es consumo.
UPDATE "Compra" c SET "esGasto" = true
WHERE NOT EXISTS (SELECT 1 FROM "DetalleCompra" d WHERE d."compraId" = c.id AND d."productoId" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "DetalleCompra" d WHERE d."compraId" = c.id);
