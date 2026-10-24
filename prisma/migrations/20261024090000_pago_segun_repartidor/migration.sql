-- Formas de pago en el aviso "en camino" según el tipo de repartidor.
ALTER TABLE "DespachoMensajeTemplate" ADD COLUMN "pagoRepartidorPropio" TEXT;
ALTER TABLE "DespachoMensajeTemplate" ADD COLUMN "pagoRepartidorContratado" TEXT;
