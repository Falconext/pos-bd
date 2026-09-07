-- Configuración de impresión de comprobantes (Perfil → Configuración).
-- ADITIVA y con default, así que las empresas existentes conservan el
-- comportamiento actual: sin QR de SUNAT y con el ticket como formato por
-- defecto (que es lo que ya hacía el sistema).
ALTER TABLE "Empresa" ADD COLUMN "mostrarQrSunat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN "formatoImpresionDefault" TEXT NOT NULL DEFAULT 'TICKET';
