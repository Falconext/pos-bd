-- API keys compartidas entre productos.
--
-- La tabla nació para Logística. Al abrir Facturación la mecánica resultó ser
-- la misma —hash, entornos, revocación, rate limit— y duplicarla por producto
-- habría dejado dos sitios donde arreglar el día que falle la autenticación.
-- El modelo de Prisma pasa a llamarse `ApiKey`; solo se le agrega de qué
-- producto es cada key.
--
-- La TABLA conserva su nombre (`@@map("ApiKeyLogistica")`). El despliegue
-- sincroniza con `prisma db push --accept-data-loss`, no con migraciones, y
-- `db push` no detecta renombrados: ante una tabla con otro nombre haría
-- DROP + CREATE y se perderían todas las API keys en uso, sin preguntar.
-- Renombrarla queda para cuando el historial de migraciones esté sano.
--
-- Solo agrega una columna y un índice: es seguro por los dos caminos, tanto
-- si lo aplica esta migración como si lo aplica `db push`.

ALTER TABLE "ApiKeyLogistica" ADD COLUMN "producto" TEXT NOT NULL DEFAULT 'logistica';

-- La consulta que importa ahora es "las keys de esta empresa para esta API".
DROP INDEX IF EXISTS "ApiKeyLogistica_empresaId_idx";
CREATE INDEX "ApiKeyLogistica_empresaId_producto_idx" ON "ApiKeyLogistica"("empresaId", "producto");
