-- Débito automático de la mensualidad con Mercado Pago.
--
-- La empresa autoriza una vez en el checkout de MP y de ahí en adelante la
-- pasarela cobra sola cada mes. Acá solo se guarda el vínculo: el id de la
-- suscripción (preapproval) es por donde el webhook ubica a la empresa cuando
-- llega un cobro.
--
-- No se guarda ningún dato de la tarjeta — nunca pasa por nuestro servidor.
--
-- Ojo con el nombre: `billingProvider` (que ya existe) es el proveedor de
-- facturación SUNAT. Esto es otra cosa: con qué le cobra Falconext a ella.

ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "cobroAutomatico" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "pasarelaCobro" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "mpPreapprovalId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "mpPreapprovalEstado" TEXT;

-- Único: una suscripción de MP pertenece a una sola empresa. Si el webhook
-- pudiera resolver dos, cobraría el mes de la equivocada.
CREATE UNIQUE INDEX IF NOT EXISTS "Empresa_mpPreapprovalId_key" ON "Empresa"("mpPreapprovalId");
