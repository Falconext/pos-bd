-- CreateTable
CREATE TABLE "grupos_modificadores" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(255),
    "esObligatorio" BOOLEAN NOT NULL DEFAULT false,
    "seleccionMin" INTEGER NOT NULL DEFAULT 0,
    "seleccionMax" INTEGER NOT NULL DEFAULT 1,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grupos_modificadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opciones_modificadores" (
    "id" SERIAL NOT NULL,
    "grupoId" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(255),
    "precioExtra" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "esDefault" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opciones_modificadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto_grupo_modificadores" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "grupoId" INTEGER NOT NULL,
    "ordenOverride" INTEGER,

    CONSTRAINT "producto_grupo_modificadores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grupos_modificadores_empresaId_activo_idx" ON "grupos_modificadores"("empresaId", "activo");

-- CreateIndex
CREATE INDEX "opciones_modificadores_grupoId_activo_idx" ON "opciones_modificadores"("grupoId", "activo");

-- CreateIndex
CREATE INDEX "producto_grupo_modificadores_productoId_idx" ON "producto_grupo_modificadores"("productoId");

-- CreateIndex
CREATE INDEX "producto_grupo_modificadores_grupoId_idx" ON "producto_grupo_modificadores"("grupoId");

-- CreateIndex
CREATE UNIQUE INDEX "producto_grupo_modificadores_productoId_grupoId_key" ON "producto_grupo_modificadores"("productoId", "grupoId");

-- AddForeignKey
ALTER TABLE "grupos_modificadores" ADD CONSTRAINT "grupos_modificadores_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opciones_modificadores" ADD CONSTRAINT "opciones_modificadores_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "grupos_modificadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_grupo_modificadores" ADD CONSTRAINT "producto_grupo_modificadores_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_grupo_modificadores" ADD CONSTRAINT "producto_grupo_modificadores_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "grupos_modificadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
