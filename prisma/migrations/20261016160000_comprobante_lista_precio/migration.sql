-- Con qué lista de precios se cobró cada comprobante.
--
-- El cajero puede cambiar la lista a mitad de venta (licorería vs. consumo en
-- el local), así que sin esto no hay forma de auditar por qué el mismo producto
-- salió a dos precios distintos el mismo día.
--
-- Denormalizado (sin FK), igual que vendedorCampoId/vendedorCampoNombre: el
-- nombre tiene que sobrevivir a que la lista se renombre o se elimine.
-- Ambas columnas son nullable, así que no tocan los comprobantes existentes.
ALTER TABLE "Comprobante" ADD COLUMN "listaPrecioId" INTEGER;
ALTER TABLE "Comprobante" ADD COLUMN "listaPrecioNombre" TEXT;
