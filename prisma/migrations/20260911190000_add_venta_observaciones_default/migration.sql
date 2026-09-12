-- Perfil → Configuración → "Observaciones por defecto de la venta".
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "ventaObservacionesDefault" TEXT;
