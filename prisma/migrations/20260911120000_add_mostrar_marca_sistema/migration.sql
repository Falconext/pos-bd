-- Perfil → Configuración → "Mostrar la marca del sistema en los comprobantes".
-- Default true: todas las empresas existentes siguen imprimiendo el pie de marca
-- (ticket, A4/A5 y cotización) hasta que lo apaguen.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "mostrarMarcaSistema" BOOLEAN NOT NULL DEFAULT true;
