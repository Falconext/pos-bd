-- El repartidor marca su entrega desde un enlace, sin cuenta en el sistema.
--
-- Para marcar una entrega hoy hace falta un usuario con acceso al módulo de
-- Ventas, donde se ven todas las ventas del día con sus montos y márgenes. A
-- un motorizado eventual eso no se le puede dar, así que nadie marcaba nada:
-- los despachos se quedaban en PREPARANDO para siempre y con ellos el aviso
-- de entrega al cliente y el cierre del cobro.
--
-- El token abre SOLO ese despacho y vence al día siguiente de entregar.
-- `entregadoEn` ya existía: el update de estado ya lo venía guardando.
ALTER TABLE "EnvioDespacho" ADD COLUMN "accesoToken" TEXT;
CREATE UNIQUE INDEX "EnvioDespacho_accesoToken_key" ON "EnvioDespacho"("accesoToken");
