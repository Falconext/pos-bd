-- Chat de soporte empresario ↔ Krezka.
--
-- Los modelos están en el esquema desde el 2026-09-18 pero nunca tuvieron
-- migración: en producción las tablas las creó el `db push` que corría en cada
-- arranque hasta el 2026-10-16. Esta migración es idempotente para cubrir los
-- dos casos: si ya existen no toca nada, y si no (una base nueva) las crea.

DO $$ BEGIN
    CREATE TYPE "EstadoSoporteConversacion" AS ENUM ('ABIERTA', 'CERRADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "RolSoporteMensaje" AS ENUM ('EMPRESA', 'SISTEMA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SoporteConversacion" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "estado" "EstadoSoporteConversacion" NOT NULL DEFAULT 'ABIERTA',
    "asignadoAId" INTEGER,
    "asignadoANombre" TEXT,
    "noLeidosEmpresa" INTEGER NOT NULL DEFAULT 0,
    "noLeidosSistema" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoporteConversacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SoporteMensaje" (
    "id" SERIAL NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "rol" "RolSoporteMensaje" NOT NULL,
    "autorNombre" TEXT,
    "contenido" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoporteMensaje_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SoporteConversacion_empresaId_key" ON "SoporteConversacion"("empresaId");
CREATE INDEX IF NOT EXISTS "SoporteConversacion_estado_actualizadoEn_idx" ON "SoporteConversacion"("estado", "actualizadoEn");
CREATE INDEX IF NOT EXISTS "SoporteMensaje_conversacionId_idx" ON "SoporteMensaje"("conversacionId");

DO $$ BEGIN
    ALTER TABLE "SoporteConversacion" ADD CONSTRAINT "SoporteConversacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "SoporteMensaje" ADD CONSTRAINT "SoporteMensaje_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "SoporteConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
