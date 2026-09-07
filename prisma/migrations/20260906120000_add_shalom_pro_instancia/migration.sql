-- Cuenta Shalom Pro conectada por empresa (planes Corporativo) para CREAR guías
-- por API. ADITIVA: todas las columnas son nullables, así que al desplegar nada
-- cambia para las empresas existentes (siguen solo con rastreo por API key global).
ALTER TABLE "Empresa" ADD COLUMN "shalomInstanceId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "shalomInstanceNombre" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "shalomInstanceEstado" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "shalomInstanceError" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "shalomInstanceSyncAt" TIMESTAMP(3);
ALTER TABLE "Empresa" ADD COLUMN "shalomSecurityCode" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "shalomAgenciaOrigenId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "shalomAgenciaOrigenNombre" TEXT;

-- Agencia destino resuelta (ter_id) y marca de cuándo se generó la guía.
ALTER TABLE "EnvioDespacho" ADD COLUMN "shalomAgenciaDestinoId" TEXT;
ALTER TABLE "EnvioDespacho" ADD COLUMN "shalomGuiaCreadaEn" TIMESTAMP(3);
