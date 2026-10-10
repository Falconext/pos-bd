-- C4: la pausa de la IA tiene fecha de vencimiento.
--
-- Antes, responder a mano apagaba el bot para siempre en esa conversación y
-- nadie volvía a encenderlo. Ahora se calla un rato y vuelve solo.
ALTER TABLE "LeadProspecto" ADD COLUMN "pausadoHasta" TIMESTAMP(3);
ALTER TABLE "LeadProspecto" ADD COLUMN "motivoPausa" TEXT;
