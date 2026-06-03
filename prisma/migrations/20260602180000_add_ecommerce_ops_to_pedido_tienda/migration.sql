ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "estadoEntrega" TEXT NOT NULL DEFAULT 'PENDIENTE';

ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "agenciaEnvio" TEXT;

ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "estadoEnvio" TEXT NOT NULL DEFAULT 'SIN_ASIGNAR';

ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "montoPagado" DECIMAL(65,30) NOT NULL DEFAULT 0;

ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "saldoPendiente" DECIMAL(65,30) NOT NULL DEFAULT 0;

ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "vendedorId" INTEGER;

ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "vendedorNombre" TEXT;

ALTER TABLE "PedidoTienda"
ADD COLUMN IF NOT EXISTS "numeroTracking" TEXT;

UPDATE "PedidoTienda"
SET
  "montoPagado" = CASE
    WHEN "medioPago" = 'TARJETA' THEN "total"
    ELSE COALESCE("montoPagado", 0)
  END,
  "saldoPendiente" = CASE
    WHEN "medioPago" = 'TARJETA' THEN 0
    ELSE GREATEST("total" - COALESCE("montoPagado", 0), 0)
  END,
  "estadoEnvio" = CASE
    WHEN "tipoEntrega" = 'ENVIO' THEN 'POR_COORDINAR'
    ELSE 'NO_APLICA'
  END,
  "agenciaEnvio" = CASE
    WHEN "tipoEntrega" = 'RECOJO' THEN COALESCE("agenciaEnvio", 'RECOJO EN TIENDA')
    ELSE "agenciaEnvio"
  END,
  "vendedorNombre" = COALESCE("vendedorNombre", 'Tienda online');

CREATE INDEX IF NOT EXISTS "PedidoTienda_empresaId_estadoEntrega_idx"
ON "PedidoTienda"("empresaId", "estadoEntrega");

CREATE INDEX IF NOT EXISTS "PedidoTienda_empresaId_estadoEnvio_idx"
ON "PedidoTienda"("empresaId", "estadoEnvio");
