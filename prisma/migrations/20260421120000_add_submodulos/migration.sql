-- CreateTable
CREATE TABLE "SubModulo" (
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
CREATE TABLE "UsuarioSubModulo" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "subModuloId" INTEGER NOT NULL,

    CONSTRAINT "UsuarioSubModulo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubModulo_codigo_key" ON "SubModulo"("codigo");

-- CreateIndex
CREATE INDEX "SubModulo_moduloId_idx" ON "SubModulo"("moduloId");

-- CreateIndex
CREATE INDEX "SubModulo_activo_orden_idx" ON "SubModulo"("activo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioSubModulo_usuarioId_subModuloId_key" ON "UsuarioSubModulo"("usuarioId", "subModuloId");

-- CreateIndex
CREATE INDEX "UsuarioSubModulo_usuarioId_idx" ON "UsuarioSubModulo"("usuarioId");

-- CreateIndex
CREATE INDEX "UsuarioSubModulo_subModuloId_idx" ON "UsuarioSubModulo"("subModuloId");

-- AddForeignKey
ALTER TABLE "SubModulo" ADD CONSTRAINT "SubModulo_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "Modulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioSubModulo" ADD CONSTRAINT "UsuarioSubModulo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioSubModulo" ADD CONSTRAINT "UsuarioSubModulo_subModuloId_fkey" FOREIGN KEY ("subModuloId") REFERENCES "SubModulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
