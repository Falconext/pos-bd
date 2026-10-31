-- Libro de Reclamaciones virtual por empresa (Ley 29571, D.S. 011-2011-PCM).
-- Hojas inmutables: sin borrado en cascada desde Empresa/Usuario (RESTRICT),
-- se conservan al menos 2 años. El correlativo AAAA-NNNNNN sale del contador
-- por empresa+año, incrementado en la misma transacción que crea la hoja.

-- CreateEnum
CREATE TYPE "TipoLibroReclamacion" AS ENUM ('RECLAMO', 'QUEJA');

-- CreateEnum
CREATE TYPE "EstadoLibroReclamacion" AS ENUM ('PENDIENTE', 'RESPONDIDO');

-- CreateTable
CREATE TABLE "LibroReclamacion" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "correlativo" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoLibroReclamacion" NOT NULL,
    "estado" "EstadoLibroReclamacion" NOT NULL DEFAULT 'PENDIENTE',
    "proveedorRazonSocial" TEXT NOT NULL,
    "proveedorRuc" TEXT NOT NULL,
    "proveedorDireccion" TEXT NOT NULL,
    "proveedorNombreComercial" TEXT,
    "nombres" TEXT NOT NULL,
    "tipoDocumento" TEXT NOT NULL,
    "numeroDocumento" TEXT NOT NULL,
    "domicilio" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "menorDeEdad" BOOLEAN NOT NULL DEFAULT false,
    "apoderadoNombre" TEXT,
    "apoderadoDocumento" TEXT,
    "bienTipo" TEXT NOT NULL,
    "bienDescripcion" TEXT NOT NULL,
    "montoReclamado" DECIMAL(12,2),
    "pedidoCodigo" TEXT,
    "detalle" TEXT NOT NULL,
    "pedidoConsumidor" TEXT NOT NULL,
    "aceptaDeclaracion" BOOLEAN NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaLimite" TIMESTAMP(3) NOT NULL,
    "respuesta" TEXT,
    "fechaRespuesta" TIMESTAMP(3),
    "respondidoPorId" INTEGER,

    CONSTRAINT "LibroReclamacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibroReclamacionContador" (
    "empresaId" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LibroReclamacionContador_pkey" PRIMARY KEY ("empresaId","anio")
);

-- CreateIndex
CREATE INDEX "LibroReclamacion_empresaId_estado_fechaLimite_idx" ON "LibroReclamacion"("empresaId", "estado", "fechaLimite");

-- CreateIndex
CREATE INDEX "LibroReclamacion_empresaId_fecha_idx" ON "LibroReclamacion"("empresaId", "fecha");

-- CreateIndex
CREATE INDEX "LibroReclamacion_estado_fechaLimite_idx" ON "LibroReclamacion"("estado", "fechaLimite");

-- CreateIndex
CREATE UNIQUE INDEX "LibroReclamacion_empresaId_codigo_key" ON "LibroReclamacion"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "LibroReclamacion_empresaId_anio_correlativo_key" ON "LibroReclamacion"("empresaId", "anio", "correlativo");

-- AddForeignKey
ALTER TABLE "LibroReclamacion" ADD CONSTRAINT "LibroReclamacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibroReclamacion" ADD CONSTRAINT "LibroReclamacion_respondidoPorId_fkey" FOREIGN KEY ("respondidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibroReclamacionContador" ADD CONSTRAINT "LibroReclamacionContador_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

