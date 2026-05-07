-- CreateTable (IF NOT EXISTS: production already has this table from before migrations were tracked)
CREATE TABLE IF NOT EXISTS "Modulo" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "icono" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Modulo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS: safe to re-run)
CREATE UNIQUE INDEX IF NOT EXISTS "Modulo_codigo_key" ON "Modulo"("codigo");
CREATE INDEX IF NOT EXISTS "Modulo_codigo_idx" ON "Modulo"("codigo");
CREATE INDEX IF NOT EXISTS "Modulo_activo_orden_idx" ON "Modulo"("activo", "orden");

-- CreateTable
CREATE TABLE IF NOT EXISTS "SubModulo" (
    "id" SERIAL NOT NULL,
    "moduloId" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubModulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UsuarioSubModulo" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "subModuloId" INTEGER NOT NULL,

    CONSTRAINT "UsuarioSubModulo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SubModulo_codigo_key" ON "SubModulo"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubModulo_moduloId_idx" ON "SubModulo"("moduloId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubModulo_activo_orden_idx" ON "SubModulo"("activo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UsuarioSubModulo_usuarioId_subModuloId_key" ON "UsuarioSubModulo"("usuarioId", "subModuloId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsuarioSubModulo_usuarioId_idx" ON "UsuarioSubModulo"("usuarioId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsuarioSubModulo_subModuloId_idx" ON "UsuarioSubModulo"("subModuloId");

-- AddForeignKey (idempotent)
DO $$ BEGIN
    ALTER TABLE "SubModulo" ADD CONSTRAINT "SubModulo_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "Modulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "UsuarioSubModulo" ADD CONSTRAINT "UsuarioSubModulo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "UsuarioSubModulo" ADD CONSTRAINT "UsuarioSubModulo_subModuloId_fkey" FOREIGN KEY ("subModuloId") REFERENCES "SubModulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
