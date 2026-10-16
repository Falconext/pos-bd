-- Los webhooks pasan a servir a las dos APIs públicas.
--
-- Solo se agrega la columna y se cambia el índice: la tabla conserva su
-- nombre (`@@map` en el modelo) porque el despliegue usa `db push`, que ante
-- un renombrado haría DROP + CREATE.
ALTER TABLE "WebhookEndpointLogistica" ADD COLUMN "producto" TEXT NOT NULL DEFAULT 'logistica';
DROP INDEX IF EXISTS "WebhookEndpointLogistica_empresaId_idx";
CREATE INDEX "WebhookEndpointLogistica_empresaId_producto_idx" ON "WebhookEndpointLogistica"("empresaId", "producto");
