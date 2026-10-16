-- Medidor y cierre mensual de la API de facturación.
--
-- Aditivo: la marca en Comprobante es nullable (los 18,312 que ya existen no
-- nacieron por la API) y la tabla de consumo es nueva.
ALTER TABLE "Comprobante" ADD COLUMN "apiPeriodoFacturado" TEXT;

CREATE TABLE "ConsumoApiMes" (
    "id" SERIAL NOT NULL,
    "integradorId" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "igv" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "aplicoMinimo" BOOLEAN NOT NULL DEFAULT false,
    "cerradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsumoApiMes_pkey" PRIMARY KEY ("id")
);

-- Un período por integrador: la última defensa contra cobrar dos veces.
CREATE UNIQUE INDEX "ConsumoApiMes_integradorId_periodo_key" ON "ConsumoApiMes"("integradorId", "periodo");
CREATE INDEX "ConsumoApiMes_periodo_idx" ON "ConsumoApiMes"("periodo");

-- Acelera el conteo del medidor, que filtra por marca y estado.
CREATE INDEX "Comprobante_apiPeriodoFacturado_idx" ON "Comprobante"("apiPeriodoFacturado") WHERE "apiPublicId" IS NOT NULL;

ALTER TABLE "ConsumoApiMes" ADD CONSTRAINT "ConsumoApiMes_integradorId_fkey"
  FOREIGN KEY ("integradorId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
