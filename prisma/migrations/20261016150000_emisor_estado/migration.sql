-- Ciclo de vida del emisor en la API: pendiente / activo / bloqueado.
--
-- Aditivo y nullable: las 62 empresas que ya existen no son emisores de ningún
-- integrador y se quedan en NULL.
ALTER TABLE "Empresa" ADD COLUMN "apiEmisorEstado" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "apiEmisorDesde" TIMESTAMP(3);
ALTER TABLE "Empresa" ADD COLUMN "apiEmisorMotivo" TEXT;
