-- Emisores de un integrador de la API.
--
-- Un integrador es otra Empresa: la que paga la factura mensual por el consumo
-- de todos los RUC que dio de alta. Se modela como auto-relación y no reusando
-- "Reseller" porque son relaciones distintas — un reseller revende el ERP con
-- su marca y tiene saldo y descuentos; un integrador consume la API y se le
-- cobra por comprobante.
--
-- "apiPublicId" existe para no exponer el id numérico: es secuencial, y
-- decirle a un integrador que es el emisor 412 le dice cuántos clientes tiene
-- Krezka.
--
-- Las dos columnas son NULL en las empresas que ya existen: un cliente directo
-- de Krezka no tiene integrador ni es emisor de la API. No hay backfill.

ALTER TABLE "Empresa" ADD COLUMN "integradorId" INTEGER;
ALTER TABLE "Empresa" ADD COLUMN "apiPublicId" TEXT;

CREATE UNIQUE INDEX "Empresa_apiPublicId_key" ON "Empresa"("apiPublicId");
CREATE INDEX "Empresa_integradorId_idx" ON "Empresa"("integradorId");

-- ON DELETE SET NULL y no CASCADE: si se borra al integrador, sus emisores
-- NO desaparecen. Son RUC reales con comprobantes emitidos ante SUNAT; lo que
-- se corta es la relación comercial, no la empresa ni su historia fiscal.
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_integradorId_fkey"
    FOREIGN KEY ("integradorId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
