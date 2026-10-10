-- A3: embedding de la respuesta del asistente, para detectar que estamos a
-- punto de repetir un mensaje que ya mandamos con otras palabras.
ALTER TABLE "LeadMensaje" ADD COLUMN "embedding" DOUBLE PRECISION[];
