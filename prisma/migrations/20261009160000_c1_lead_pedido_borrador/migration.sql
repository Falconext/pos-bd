-- C1: lo que la IA va armando de un pedido mientras conversa.
--
-- Los datos llegan de a uno y en desorden: el distrito en el mensaje 4, el
-- nombre en el 9, el celular cuando ya aceptó. Sin dónde acumularlos, la IA
-- releería toda la conversación en cada turno y volvería a preguntar lo ya
-- dicho, que es lo que el banco de pruebas del cliente castiga.
CREATE TABLE "LeadPedidoBorrador" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "zona" TEXT,
    "tipoZona" TEXT,
    "lugar" TEXT,
    "destinoRegion" TEXT,
    "costoEnvio" DECIMAL(10,2),
    "nombre" TEXT,
    "dni" TEXT,
    "celular" TEXT,
    "direccion" TEXT,
    "referencia" TEXT,
    "horario" TEXT,
    "agenciaSede" TEXT,
    "recibeNombre" TEXT,
    "recibeDni" TEXT,
    "itemsJson" JSONB,
    "cotizacionId" INTEGER,
    "cotizadoEn" TIMESTAMP(3),
    "comprobanteId" INTEGER,
    "registradoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeadPedidoBorrador_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadPedidoBorrador_conversacionId_key" ON "LeadPedidoBorrador"("conversacionId");
CREATE INDEX "LeadPedidoBorrador_empresaId_idx" ON "LeadPedidoBorrador"("empresaId");

ALTER TABLE "LeadPedidoBorrador" ADD CONSTRAINT "LeadPedidoBorrador_conversacionId_fkey"
  FOREIGN KEY ("conversacionId") REFERENCES "LeadConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
