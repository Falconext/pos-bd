-- Credenciales de API del SIRE (distintas de las de Consulta de Validez).
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "sireClientId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "sireClientSecret" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "sireUsuarioSol" TEXT;
-- Clave SOL cifrada (AES-256-GCM), nunca en claro.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "sireClaveSol" TEXT;
