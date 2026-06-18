DO $$ BEGIN
  CREATE TYPE "EstadoProductoReview" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'OCULTO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ProductoReview" (
  "id" SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "productoId" INTEGER NOT NULL,
  "pedidoId" INTEGER,
  "clienteId" INTEGER,
  "clienteNombre" TEXT NOT NULL,
  "clienteEmail" TEXT,
  "clienteTelefono" TEXT,
  "rating" INTEGER NOT NULL,
  "comentario" TEXT NOT NULL,
  "estado" "EstadoProductoReview" NOT NULL DEFAULT 'PENDIENTE',
  "compraVerificada" BOOLEAN NOT NULL DEFAULT false,
  "token" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aprobadoEn" TIMESTAMP(3),
  CONSTRAINT "ProductoReview_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductoReview_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductoReview_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "PedidoTienda"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ProductoReview_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductoReview_token_key" ON "ProductoReview"("token");
CREATE INDEX IF NOT EXISTS "ProductoReview_empresaId_estado_creadoEn_idx" ON "ProductoReview"("empresaId", "estado", "creadoEn");
CREATE INDEX IF NOT EXISTS "ProductoReview_productoId_estado_idx" ON "ProductoReview"("productoId", "estado");
CREATE INDEX IF NOT EXISTS "ProductoReview_pedidoId_idx" ON "ProductoReview"("pedidoId");
