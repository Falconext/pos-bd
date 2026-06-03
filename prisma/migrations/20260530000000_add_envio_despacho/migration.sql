-- CreateEnum
CREATE TYPE "EstadoDespacho" AS ENUM ('PREPARANDO', 'EN_CAMINO', 'EN_DESTINO', 'ENTREGADO', 'DEVUELTO');

-- CreateTable
CREATE TABLE "EnvioDespacho" (
    "id"               SERIAL NOT NULL,
    "comprobanteId"    INTEGER NOT NULL,
    "transportista"    TEXT,
    "codigoGuia"       TEXT,
    "estado"           "EstadoDespacho" NOT NULL DEFAULT 'PREPARANDO',
    "observaciones"    TEXT,
    "direccionDestino" TEXT,
    "fechaEstimada"    TIMESTAMP(3),
    "historial"        JSONB,
    "creadoEn"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvioDespacho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvioDespacho_comprobanteId_key" ON "EnvioDespacho"("comprobanteId");
CREATE INDEX "EnvioDespacho_comprobanteId_idx" ON "EnvioDespacho"("comprobanteId");

-- AddForeignKey
ALTER TABLE "EnvioDespacho" ADD CONSTRAINT "EnvioDespacho_comprobanteId_fkey"
    FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
