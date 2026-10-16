-- Un cobro puede ser la mensualidad del ERP o el consumo de la API.
--
-- La clave única pasa a incluir el concepto: un integrador puede ser las dos
-- cosas a la vez y pagar ambas en el mismo mes. Sin esto, el segundo cobro
-- chocaría contra el primero y se perdería en silencio, porque el emisor de
-- mensualidades trata ese choque como "ya se emitió".
--
-- La tabla está vacía en producción, así que el cambio de índice no toca datos.
ALTER TABLE "CobroEmpresa" ADD COLUMN "concepto" TEXT NOT NULL DEFAULT 'MENSUALIDAD';
DROP INDEX IF EXISTS "CobroEmpresa_empresaId_periodo_key";
CREATE UNIQUE INDEX "CobroEmpresa_empresaId_periodo_concepto_key" ON "CobroEmpresa"("empresaId", "periodo", "concepto");
