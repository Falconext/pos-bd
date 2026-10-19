-- Descripción / detalle adicional (multilínea) por línea de comprobante.
--
-- Pedido de empresarios de servicios (pintura, obras): en la cotización cada
-- ítem lleva un título ("RETIRO DE PINTURA DE PARED PISO 6") y debajo el
-- detalle del trabajo en varias líneas. Se imprime en el PDF; no viaja al XML
-- de SUNAT (ahí el ítem sigue con `descripcion`).
--
-- Columna nullable: no toca las filas existentes.
ALTER TABLE "DetalleComprobante" ADD COLUMN "detalleAdicional" TEXT;
