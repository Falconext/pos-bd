-- Guarda todas las opciones de la búsqueda de imagen IA para volver a ofrecerlas
ALTER TABLE "ImagenProductoAprobadaIa" ADD COLUMN IF NOT EXISTS "candidatos" JSONB;
