-- Perfil → Configuración → "Catálogo independiente por sede".
-- Default false: todas las empresas existentes siguen con catálogo compartido
-- (un producto nuevo queda disponible en todas las sedes), sin ningún cambio.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "catalogoPorSede" BOOLEAN NOT NULL DEFAULT false;
