-- Varias notas de venta facturadas en una sola boleta/factura
CREATE TABLE "ComprobanteOrigenExtra" (
    "origenId" INTEGER NOT NULL,
    "formalId" INTEGER NOT NULL,
    CONSTRAINT "ComprobanteOrigenExtra_pkey" PRIMARY KEY ("origenId")
);

CREATE INDEX "ComprobanteOrigenExtra_formalId_idx" ON "ComprobanteOrigenExtra"("formalId");

ALTER TABLE "ComprobanteOrigenExtra" ADD CONSTRAINT "ComprobanteOrigenExtra_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "Comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComprobanteOrigenExtra" ADD CONSTRAINT "ComprobanteOrigenExtra_formalId_fkey" FOREIGN KEY ("formalId") REFERENCES "Comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
