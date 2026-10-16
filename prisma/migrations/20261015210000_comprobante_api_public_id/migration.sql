-- Id opaco para la API pública de facturación.
--
-- Aditiva y nullable a propósito: los 18,207 comprobantes que ya existen no
-- nacieron por la API y se quedan en NULL. El índice único los tolera porque
-- Postgres no considera iguales dos NULL.
ALTER TABLE "Comprobante" ADD COLUMN "apiPublicId" TEXT;
CREATE UNIQUE INDEX "Comprobante_apiPublicId_key" ON "Comprobante"("apiPublicId");
