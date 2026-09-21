-- POS por empresa (pedido Demenver): comprobante con el que arranca cada venta y
-- exigir Boleta/Factura cuando el cobro incluye Yape/Plin/Transferencia/Tarjeta.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "posComprobanteDefault" TEXT NOT NULL DEFAULT 'MANTENER_ULTIMO';
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "posExigirCpeMedioPago" BOOLEAN NOT NULL DEFAULT false;
