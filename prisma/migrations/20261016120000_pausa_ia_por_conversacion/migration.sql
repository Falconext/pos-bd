-- Tomar el chat también en las conversaciones sin prospecto.
--
-- La pausa de la IA vivía solo en LeadProspecto. Los chats de prueba del
-- propio negocio no generan prospecto a propósito (para no ensuciar el
-- embudo), así que en ellos no había forma de apagar la IA: ni botón en el
-- panel, ni pausa al responder a mano. Eran los únicos chats donde el dueño
-- realmente necesita tomar el control, porque son los que usa para probar.
ALTER TABLE "LeadConversacion"
  ADD COLUMN "botActivo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pausadoHasta" TIMESTAMP(3),
  ADD COLUMN "motivoPausa" TEXT;

-- Las pausas que ya estaban puestas en el prospecto se copian a su
-- conversación: sin esto, al pasar a leer la pausa desde la conversación, un
-- chat derivado a una persona volvería a contestarlo la IA.
UPDATE "LeadConversacion" c
SET "botActivo" = p."botActivo",
    "pausadoHasta" = p."pausadoHasta",
    "motivoPausa" = p."motivoPausa"
FROM "LeadProspecto" p
WHERE p."conversacionId" = c."id"
  AND p."botActivo" = false;
