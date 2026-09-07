-- Integración Olva Courier (api.olva-api.lat). ADITIVA: todas las columnas son
-- nullables o traen default, así que al desplegar nada cambia para las empresas
-- y despachos existentes (siguen igual hasta que configuren su agencia Olva).

-- Configuración por empresa. No hay cuenta que conectar como en Shalom Pro: el
-- proveedor autentica todo con la API key global (OLVA_API_KEY).
ALTER TABLE "Empresa" ADD COLUMN "olvaAgenciaOrigenCodigo" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "olvaAgenciaOrigenNombre" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "olvaAgenciaOrigenUbigeo" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "olvaAutoTrackingActivo" BOOLEAN NOT NULL DEFAULT false;

-- Rastreo persistido (read-through cache) y datos de la guía generada.
-- El N° de guía Olva se guarda en "nroOrden" (Olva no usa clave, solo número).
ALTER TABLE "EnvioDespacho" ADD COLUMN "olvaEstado" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN "olvaEntregado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EnvioDespacho" ADD COLUMN "olvaTrackingJson" JSONB;
ALTER TABLE "EnvioDespacho" ADD COLUMN "olvaSyncAt" TIMESTAMP(3);
ALTER TABLE "EnvioDespacho" ADD COLUMN "olvaAgenciaDestinoCodigo" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN "olvaGuiaCreadaEn" TIMESTAMP(3);
ALTER TABLE "EnvioDespacho" ADD COLUMN "olvaRespuestaJson" JSONB;

-- Peso del paquete: Olva lo exige para registrar la guía y para cotizar.
ALTER TABLE "EnvioDespacho" ADD COLUMN "pesoKg" DOUBLE PRECISION;
