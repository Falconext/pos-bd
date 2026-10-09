-- B4: búsqueda tolerante a cómo escribe el cliente.
--
-- "fenocreco" por "Fenogreco" no lo encuentra ningún AND de palabras, y el
-- cliente no va a reescribirlo: se va. pg_trgm compara por trigramas y sí lo
-- encuentra (medido: 0.538 de word_similarity contra el catálogo real).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice para que la similitud no recorra el catálogo entero. GIN con
-- gin_trgm_ops es lo que hace que esto sea viable con 2,000 SKUs.
CREATE INDEX IF NOT EXISTS "Producto_descripcion_trgm_idx"
  ON "Producto" USING gin ("descripcion" gin_trgm_ops);
