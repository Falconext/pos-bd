-- Días hasta el aviso de recompra por producto (null = lo de la empresa; 0 = no se recompra)
ALTER TABLE "Producto" ADD COLUMN "diasRecompra" INTEGER;
