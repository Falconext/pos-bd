-- Precio por mayor mezclando productos (POS). Aditiva: apagado por defecto.
ALTER TABLE "Empresa" ADD COLUMN "mayoristaMezclaActivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN "mayoristaMezclaCategoriaIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
