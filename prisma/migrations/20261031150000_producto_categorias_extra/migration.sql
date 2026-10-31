-- Un producto puede estar en varias categorías (31-10): la principal sigue en
-- "Producto"."categoriaId" y las adicionales viven en esta tabla.
CREATE TABLE "ProductoCategoriaExtra" (
    "productoId" INTEGER NOT NULL,
    "categoriaId" INTEGER NOT NULL,

    CONSTRAINT "ProductoCategoriaExtra_pkey" PRIMARY KEY ("productoId","categoriaId")
);

CREATE INDEX "ProductoCategoriaExtra_categoriaId_idx" ON "ProductoCategoriaExtra"("categoriaId");
CREATE INDEX IF NOT EXISTS "Producto_categoriaId_idx" ON "Producto"("categoriaId");

ALTER TABLE "ProductoCategoriaExtra" ADD CONSTRAINT "ProductoCategoriaExtra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductoCategoriaExtra" ADD CONSTRAINT "ProductoCategoriaExtra_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
