-- Avisos de despacho (31-10): textos opcionales para provincia (agencia),
-- distintos del delivery local de Lima. Null = sale el texto general.
ALTER TABLE "DespachoMensajeTemplate" ADD COLUMN "mensajeEnCaminoAgencia" TEXT;
ALTER TABLE "DespachoMensajeTemplate" ADD COLUMN "mensajeEntregadoAgencia" TEXT;
