-- Por sede: el usuario puede entrar pero no vender ahí. Default true = como hoy.
ALTER TABLE "UsuarioSede" ADD COLUMN "puedeVender" BOOLEAN NOT NULL DEFAULT true;

-- Usuario que solo gestiona fotos de productos. Default false = como hoy.
ALTER TABLE "Usuario" ADD COLUMN "soloImagenesProductos" BOOLEAN NOT NULL DEFAULT false;
