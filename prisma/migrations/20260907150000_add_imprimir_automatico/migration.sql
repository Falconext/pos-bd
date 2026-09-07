-- Impresión automática al emitir (Perfil → Configuración). ADITIVA y opt-in:
-- con `false` el flujo queda exactamente como está hoy (el cajero elige formato
-- en el modal del comprobante emitido).
ALTER TABLE "Empresa" ADD COLUMN "imprimirAutomatico" BOOLEAN NOT NULL DEFAULT false;
