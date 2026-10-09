-- B1 y B2: qué se le puede prometer al cliente sobre un producto, y cuánto
-- empujarlo frente a sus equivalentes.
--
-- Sin backfill a propósito: `disponibilidad` NULL significa "dedúcela del
-- stock", que es exactamente el comportamiento de hoy. Quien no lleva
-- inventario (Hierba Sana) la pone a mano y entonces manda sobre el stock.
CREATE TYPE "DisponibilidadProducto" AS ENUM ('INMEDIATA', 'BAJO_PEDIDO', 'NO_DISPONIBLE');

ALTER TABLE "Producto" ADD COLUMN "disponibilidad" "DisponibilidadProducto";
ALTER TABLE "Producto" ADD COLUMN "prioridadVenta" INTEGER;
