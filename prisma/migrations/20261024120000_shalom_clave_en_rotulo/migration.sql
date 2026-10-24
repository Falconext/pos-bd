-- La clave de retiro deja de salir en el rótulo, salvo que la empresa lo pida.
ALTER TABLE "Empresa" ADD COLUMN "shalomClaveEnRotulo" BOOLEAN NOT NULL DEFAULT false;
