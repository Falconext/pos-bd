-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EstadoOrdenCompra" AS ENUM ('BORRADOR', 'EMITIDA', 'RECIBIDA', 'ANULADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrdenCompra" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "sedeId" INTEGER,
    "proveedorId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "numero" INTEGER NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaEntrega" TIMESTAMP(3),
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "tipoCambio" DECIMAL(65,30) DEFAULT 1,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "igv" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estado" "EstadoOrdenCompra" NOT NULL DEFAULT 'EMITIDA',
    "observaciones" TEXT,
    "condicionesPago" TEXT,
    "lugarEntrega" TEXT,
    "compraId" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrdenCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DetalleOrdenCompra" (
    "id" SERIAL NOT NULL,
    "ordenCompraId" INTEGER NOT NULL,
    "productoId" INTEGER,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(65,30) NOT NULL,
    "precioUnitario" DECIMAL(65,30) NOT NULL,
    "subtotal" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "DetalleOrdenCompra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrdenCompra_compraId_key" ON "OrdenCompra"("compraId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrdenCompra_empresaId_numero_key" ON "OrdenCompra"("empresaId", "numero");
CREATE INDEX IF NOT EXISTS "OrdenCompra_empresaId_estado_idx" ON "OrdenCompra"("empresaId", "estado");
CREATE INDEX IF NOT EXISTS "DetalleOrdenCompra_ordenCompraId_idx" ON "DetalleOrdenCompra"("ordenCompraId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DetalleOrdenCompra" ADD CONSTRAINT "DetalleOrdenCompra_ordenCompraId_fkey" FOREIGN KEY ("ordenCompraId") REFERENCES "OrdenCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DetalleOrdenCompra" ADD CONSTRAINT "DetalleOrdenCompra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed del submódulo del sidebar (idempotente): Órdenes de compra bajo Compras,
-- habilitado en todos los planes que ya incluyen el módulo compras.
INSERT INTO "SubModulo" (codigo, nombre, descripcion, orden, "moduloId")
SELECT 'compras:ordenes', 'Órdenes de compra', 'Órdenes de compra a proveedores (pedido → recepción)', 3, m.id
FROM "Modulo" m WHERE m.codigo='compras'
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO "PlanSubModulo" ("planId", "subModuloId")
SELECT pm."planId", sm.id
FROM "PlanModulo" pm
JOIN "Modulo" m ON m.id = pm."moduloId" AND m.codigo='compras'
JOIN "SubModulo" sm ON sm.codigo='compras:ordenes'
ON CONFLICT DO NOTHING;
