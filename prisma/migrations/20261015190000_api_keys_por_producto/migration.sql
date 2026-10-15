-- API keys compartidas entre productos.
--
-- La tabla nació para Logística. Al abrir Facturación la mecánica resultó ser
-- la misma —hash, entornos, revocación, rate limit— y duplicarla por producto
-- habría dejado dos sitios donde arreglar el día que algo falle en la
-- autenticación. Se renombra y se le agrega de qué producto es cada key.
--
-- RENAME y no una tabla nueva: preserva los datos y las keys que ya están en
-- uso. El DEFAULT 'logistica' hace que las existentes sigan sirviendo para lo
-- mismo que servían, sin backfill.
--
-- Ventana de despliegue: entre el ALTER y el arranque del código nuevo, el
-- código viejo consulta "ApiKeyLogistica", que ya no existe. Son segundos y
-- afecta solo a la API pública de Logística, que está en beta.

ALTER TABLE "ApiKeyLogistica" RENAME TO "ApiKey";

ALTER TABLE "ApiKey" ADD COLUMN "producto" TEXT NOT NULL DEFAULT 'logistica';

-- Los índices conservan su nombre viejo tras el RENAME; se renombran para que
-- el esquema no quede mintiendo sobre a qué tabla pertenecen.
ALTER INDEX "ApiKeyLogistica_pkey" RENAME TO "ApiKey_pkey";
ALTER INDEX "ApiKeyLogistica_hash_key" RENAME TO "ApiKey_hash_key";
ALTER INDEX "ApiKeyLogistica_hash_idx" RENAME TO "ApiKey_hash_idx";

-- El índice por empresa pasa a incluir el producto: la consulta que importa
-- ahora es "las keys de esta empresa para esta API".
DROP INDEX IF EXISTS "ApiKeyLogistica_empresaId_idx";
CREATE INDEX "ApiKey_empresaId_producto_idx" ON "ApiKey"("empresaId", "producto");

ALTER TABLE "ApiKey" RENAME CONSTRAINT "ApiKeyLogistica_empresaId_fkey" TO "ApiKey_empresaId_fkey";
