-- A1: caja negra del turno de la IA de Ventas.
-- Guarda las herramientas que el modelo pidió al generar este mensaje
-- (nombre, argumentos y resultado), para auditar por qué respondió lo que
-- respondió y para alimentar la analítica de consultas (E2).
ALTER TABLE "LeadMensaje" ADD COLUMN "herramientasJson" JSONB;
