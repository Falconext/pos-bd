-- C1: configuración comercial de la IA por empresa (zonas y tarifas de envío,
-- franjas de entrega, tramos de descuento).
--
-- En un JSON y no en columnas porque son tablas que el negocio edita, no
-- campos que el sistema consulta: nunca se filtra ni se ordena por ellas.
ALTER TABLE "Empresa" ADD COLUMN "iaVentasConfigJson" JSONB;
