-- Órdenes de compra armadas desde varias notas de venta (preventa)
CREATE TABLE "OrdenCompraOrigen" (
    "ordenCompraId" INTEGER NOT NULL,
    "comprobanteId" INTEGER NOT NULL,
    CONSTRAINT "OrdenCompraOrigen_pkey" PRIMARY KEY ("ordenCompraId","comprobanteId")
);

CREATE INDEX "OrdenCompraOrigen_comprobanteId_idx" ON "OrdenCompraOrigen"("comprobanteId");

ALTER TABLE "OrdenCompraOrigen" ADD CONSTRAINT "OrdenCompraOrigen_ordenCompraId_fkey" FOREIGN KEY ("ordenCompraId") REFERENCES "OrdenCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrdenCompraOrigen" ADD CONSTRAINT "OrdenCompraOrigen_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
