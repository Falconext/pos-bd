-- Consumo de la API: datos para facturarle al integrador, la factura emitida
-- por el pago y las marcas de los recordatorios (para no mandarlos dos veces).
ALTER TABLE "Empresa" ADD COLUMN "datosFacturacion" JSONB;
ALTER TABLE "CobroEmpresa" ADD COLUMN "comprobanteId" INTEGER;
ALTER TABLE "CobroEmpresa" ADD COLUMN "avisoPrevioEn" TIMESTAMP(3);
ALTER TABLE "CobroEmpresa" ADD COLUMN "avisoBloqueoEn" TIMESTAMP(3);
