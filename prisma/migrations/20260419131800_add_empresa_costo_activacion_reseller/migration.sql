-- Add costoActivacionReseller to Empresa to track how much pagó el reseller al activar cada cliente
ALTER TABLE "Empresa"
    ADD COLUMN "costoActivacionReseller" DECIMAL(65,30) DEFAULT 0;
