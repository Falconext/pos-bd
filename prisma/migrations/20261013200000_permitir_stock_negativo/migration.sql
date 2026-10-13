-- Permitir que una salida sin stock deje el saldo negativo en vez de recortarlo
-- a 0 y perder el descuento. Default false = comportamiento histórico.
ALTER TABLE "Empresa"
  ADD COLUMN IF NOT EXISTS "permitirStockNegativo" BOOLEAN NOT NULL DEFAULT false;
