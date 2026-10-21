-- Productos quitados de un kit vendido como una línea (ver kit-quitados.ts).
ALTER TABLE "DetalleComprobante" ADD COLUMN "kitQuitados" JSONB;
