-- Un solo envío para varias notas del mismo cliente
CREATE TABLE "EnvioDespachoNota" (
    "comprobanteId" INTEGER NOT NULL,
    "despachoId" INTEGER NOT NULL,
    CONSTRAINT "EnvioDespachoNota_pkey" PRIMARY KEY ("comprobanteId")
);

CREATE INDEX "EnvioDespachoNota_despachoId_idx" ON "EnvioDespachoNota"("despachoId");

ALTER TABLE "EnvioDespachoNota" ADD CONSTRAINT "EnvioDespachoNota_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "EnvioDespacho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EnvioDespachoNota" ADD CONSTRAINT "EnvioDespachoNota_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
