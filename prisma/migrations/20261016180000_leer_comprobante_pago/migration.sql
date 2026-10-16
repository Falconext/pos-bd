-- Leer el comprobante de pago que manda el cliente.
--
-- Hasta ahora la imagen se bajaba y se archivaba sin abrirla: el pedido
-- quedaba esperando a que una persona mirara la foto para saber de cuánto
-- era y si el número de operación coincidía. El dueño de Hierba Sana lo
-- reportó al revés —"insiste con el comprobante pero no hace nada con él"—.
--
-- Todas las columnas son opcionales a propósito: una foto borrosa, un recibo
-- de un banco raro o la IA caída no pueden frenar una venta. Si no se pudo
-- leer, el flujo sigue exactamente como antes.
ALTER TABLE "LeadComprobantePago"
  ADD COLUMN "montoLeido"     DECIMAL(10,2),
  ADD COLUMN "operacionLeida" TEXT,
  ADD COLUMN "fechaLeida"     TEXT,
  ADD COLUMN "medioLeido"     TEXT,
  ADD COLUMN "pagadorLeido"   TEXT,
  ADD COLUMN "leidoEn"        TIMESTAMP(3);
