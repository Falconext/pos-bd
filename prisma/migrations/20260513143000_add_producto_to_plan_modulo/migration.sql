-- Add producto axis to plans and modules
ALTER TABLE "Plan"
ADD COLUMN "producto" TEXT NOT NULL DEFAULT 'facturacion';

ALTER TABLE "Modulo"
ADD COLUMN "producto" TEXT NOT NULL DEFAULT 'facturacion';

CREATE INDEX "Plan_producto_idx" ON "Plan"("producto");
CREATE INDEX "Modulo_producto_idx" ON "Modulo"("producto");
