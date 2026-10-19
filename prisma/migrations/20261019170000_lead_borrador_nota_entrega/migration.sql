-- Indicaciones para el motorizado que da el cliente por WhatsApp (vuelto,
-- piso, timbre). La IA de Ventas le decía "ya le avisamos al motorizado" y el
-- dato no se guardaba: no llegaba ni al despacho ni a la nota de venta.
--
-- Columna nullable: no toca las filas existentes.
ALTER TABLE "LeadPedidoBorrador" ADD COLUMN "notaEntrega" TEXT;
