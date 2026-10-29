-- Envío por agencia (Shalom / Olva) desde la tienda virtual.
ALTER TABLE "Empresa" ADD COLUMN "couriersTienda" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "PedidoTienda" ADD COLUMN "envioCourier" TEXT,
ADD COLUMN "envioAgenciaId" TEXT,
ADD COLUMN "envioAgenciaNombre" TEXT,
ADD COLUMN "clienteDocumento" TEXT;
