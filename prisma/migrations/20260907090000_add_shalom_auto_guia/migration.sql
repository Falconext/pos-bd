-- Opt-in por empresa para generar la guía Shalom automáticamente al cerrar la
-- venta. ADITIVA con default false: al desplegar, ninguna empresa empieza a
-- crear envíos reales hasta que lo active explícitamente.
ALTER TABLE "Empresa" ADD COLUMN "shalomAutoGuiaActivo" BOOLEAN NOT NULL DEFAULT false;
