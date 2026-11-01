-- Stock de la tienda virtual por sede (01-11).
-- La tienda dejaba de saber de sedes: mostraba y validaba la SUMA de todas.
-- Ahora el negocio elige de qué stock vende (ver src/tienda/stock-tienda.ts).
CREATE TYPE "ModoStockTienda" AS ENUM ('SEDE', 'CLIENTE', 'TODAS');

ALTER TABLE "Empresa"
  ADD COLUMN "tiendaStockModo" "ModoStockTienda" NOT NULL DEFAULT 'SEDE',
  ADD COLUMN "tiendaSedeId" INTEGER,
  ADD COLUMN "tiendaSedesIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "tiendaStockModoElegidoEn" TIMESTAMP(3);

ALTER TABLE "Empresa"
  ADD CONSTRAINT "Empresa_tiendaSedeId_fkey" FOREIGN KEY ("tiendaSedeId")
  REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No romper lo que ven hoy: las empresas con más de una sede activa siguen
-- vendiendo la suma de sus sedes (TODAS). Con una sola sede, SEDE es lo mismo
-- que antes. `tiendaStockModoElegidoEn` queda en NULL: el panel invita a las
-- de varias sedes a elegir.
UPDATE "Empresa" e
SET "tiendaStockModo" = 'TODAS'
WHERE (
  SELECT COUNT(*) FROM "Sede" s WHERE s."empresaId" = e."id" AND s."activo" = true
) > 1;
