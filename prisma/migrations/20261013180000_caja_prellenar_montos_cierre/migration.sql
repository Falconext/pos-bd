-- Prellenar los montos al cerrar caja. Default true = el comportamiento que ya
-- tenían: se agregó sin opción a pedido de un empresario, y ahora se puede
-- apagar para los negocios que sí arquean a ciegas.
ALTER TABLE "Empresa"
  ADD COLUMN IF NOT EXISTS "cajaPrellenarMontosCierre" BOOLEAN NOT NULL DEFAULT true;
