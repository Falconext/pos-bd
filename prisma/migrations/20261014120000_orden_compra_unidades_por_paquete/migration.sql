-- Pedirle al proveedor "5 cajas de 6" en vez de "30 unidades".
--
-- La cantidad sigue guardándose en UNIDADES (igual que el stock), así que
-- recibir la orden no cambia. Esta columna solo recuerda de qué tamaño era la
-- caja, para mostrar la orden y su PDF en cajas.
--
-- Nullable a propósito: las órdenes ya emitidas se pidieron por unidad y así
-- se quedan.
ALTER TABLE "DetalleOrdenCompra"
  ADD COLUMN IF NOT EXISTS "unidadesPorPaquete" INTEGER;
