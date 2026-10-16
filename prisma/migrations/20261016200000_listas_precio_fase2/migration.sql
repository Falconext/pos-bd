-- Fase 2 de listas de precios: paridad de la pantalla de configuración.
--
-- Todo aditivo y nullable (o con default), así que no toca datos existentes
-- ni cambia el comportamiento de ninguna lista ya creada.

-- Para qué es la lista, y desempate explícito cuando dos podrían aplicar.
-- `orden` arranca en 0 para todas: el desempate sigue siendo por id hasta que
-- el empresario las reordene, igual que antes.
ALTER TABLE "ListaPrecio" ADD COLUMN "descripcion" TEXT;
ALTER TABLE "ListaPrecio" ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 0;

-- Descuento en % de la lista sobre el precio (distinto de precioOferta, que es
-- un precio fijo).
ALTER TABLE "ListaPrecioItem" ADD COLUMN "descuentoPorcentaje" DECIMAL(5,2);

-- Piso y techo de venta del producto. Aunque el vendedor pueda editar el
-- precio, no puede salirse de acá.
ALTER TABLE "Producto" ADD COLUMN "precioMinimoVenta" DECIMAL(65,30);
ALTER TABLE "Producto" ADD COLUMN "precioMaximoVenta" DECIMAL(65,30);

-- Precio pactado con un cliente concreto.
CREATE TABLE "ListaPrecioCliente" (
    "id" SERIAL NOT NULL,
    "listaPrecioId" INTEGER NOT NULL,
    "clienteId" INTEGER NOT NULL,
    CONSTRAINT "ListaPrecioCliente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ListaPrecioCliente_listaPrecioId_clienteId_key" ON "ListaPrecioCliente"("listaPrecioId", "clienteId");
CREATE INDEX "ListaPrecioCliente_listaPrecioId_idx" ON "ListaPrecioCliente"("listaPrecioId");
CREATE INDEX "ListaPrecioCliente_clienteId_idx" ON "ListaPrecioCliente"("clienteId");
ALTER TABLE "ListaPrecioCliente" ADD CONSTRAINT "ListaPrecioCliente_listaPrecioId_fkey" FOREIGN KEY ("listaPrecioId") REFERENCES "ListaPrecio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListaPrecioCliente" ADD CONSTRAINT "ListaPrecioCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
