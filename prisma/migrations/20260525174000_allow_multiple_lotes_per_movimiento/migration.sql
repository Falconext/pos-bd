-- Permitir múltiples lotes asociados a un mismo movimiento de kardex
-- (necesario para salidas FEFO cuando un comprobante consume varios lotes)
DROP INDEX IF EXISTS "MovimientoKardexLote_movimientoId_key";

CREATE INDEX IF NOT EXISTS "movimiento_kardex_lotes_movimientoId_idx"
  ON "movimiento_kardex_lotes"("movimientoId");
