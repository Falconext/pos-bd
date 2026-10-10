-- CreateEnum
CREATE TYPE "TipoEvidenciaEntrega" AS ENUM ('FOTO_PAQUETE', 'FOTO_RECEPTOR', 'FIRMA', 'DOCUMENTO');

-- CreateEnum
CREATE TYPE "TipoDisparoLead" AS ENUM ('VUELTA_DISPONIBILIDAD', 'RECUPERAR_COTIZACION', 'CARRITO_EN_ESPERA', 'POST_ENTREGA', 'RECOMPRA', 'REACTIVACION');

-- CreateEnum
CREATE TYPE "EstadoDisparoLead" AS ENUM ('PROGRAMADO', 'ENVIADO', 'CANCELADO', 'OMITIDO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "EtapaCrmLead" AS ENUM ('NUEVO', 'DIAGNOSTICADO', 'COTIZADO', 'DATOS_COMPLETOS', 'PENDIENTE_VALIDACION_PAGO', 'POR_DESPACHAR', 'EN_RUTA', 'ENTREGADO', 'REPROGRAMADO', 'FRIO', 'NO_CONTESTA', 'CONSULTADO_NO_HABIDO');

-- CreateEnum
CREATE TYPE "TipoLeadConsulta" AS ENUM ('PRODUCTO', 'MALESTAR');




-- AlterTable
ALTER TABLE "EnvioDespacho" ADD COLUMN     "entregadoEn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadProspecto" ADD COLUMN     "edad" INTEGER,
ADD COLUMN     "etapa" "EtapaCrmLead" NOT NULL DEFAULT 'NUEVO',
ADD COLUMN     "etapaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sexo" TEXT;

-- AlterTable
ALTER TABLE "LeadPedidoBorrador" ADD COLUMN     "descuentoAplicado" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "EvidenciaEntrega" (
    "id" SERIAL NOT NULL,
    "despachoId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "tipo" "TipoEvidenciaEntrega" NOT NULL DEFAULT 'FOTO_PAQUETE',
    "nota" TEXT,
    "usuarioId" INTEGER,
    "usuarioNombre" TEXT,
    "repartidorId" INTEGER,
    "tomadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaEntrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDisparo" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "tipo" "TipoDisparoLead" NOT NULL,
    "telefono" TEXT NOT NULL,
    "prospectoId" INTEGER,
    "conversacionId" INTEGER,
    "referencia" TEXT NOT NULL,
    "programadoPara" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoDisparoLead" NOT NULL DEFAULT 'PROGRAMADO',
    "motivo" TEXT,
    "plantilla" TEXT,
    "parametrosJson" JSONB,
    "textoEnviado" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDisparo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadBajaAvisos" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "telefono" TEXT NOT NULL,
    "mensaje" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadBajaAvisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEtapaHistorial" (
    "id" SERIAL NOT NULL,
    "prospectoId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "desde" "EtapaCrmLead",
    "hacia" "EtapaCrmLead" NOT NULL,
    "actor" TEXT NOT NULL,
    "usuarioId" INTEGER,
    "nota" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEtapaHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadComprobantePago" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "prospectoId" INTEGER NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "url" TEXT,
    "mediaId" TEXT,
    "nota" TEXT,
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validadoEn" TIMESTAMP(3),
    "validadoPor" TEXT,
    "validadoPorId" INTEGER,
    "rechazadoEn" TIMESTAMP(3),
    "rechazadoMotivo" TEXT,

    CONSTRAINT "LeadComprobantePago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadConsulta" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "prospectoId" INTEGER,
    "telefono" TEXT NOT NULL,
    "tipo" "TipoLeadConsulta" NOT NULL,
    "texto" TEXT NOT NULL,
    "hubo" BOOLEAN NOT NULL DEFAULT false,
    "productoId" INTEGER,
    "disponibilidad" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadConsulta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenciaEntrega_despachoId_idx" ON "EvidenciaEntrega"("despachoId");

-- CreateIndex
CREATE INDEX "EvidenciaEntrega_empresaId_anuladaEn_idx" ON "EvidenciaEntrega"("empresaId", "anuladaEn");

-- CreateIndex
CREATE INDEX "LeadDisparo_empresaId_estado_programadoPara_idx" ON "LeadDisparo"("empresaId", "estado", "programadoPara");

-- CreateIndex
CREATE INDEX "LeadDisparo_empresaId_telefono_idx" ON "LeadDisparo"("empresaId", "telefono");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDisparo_empresaId_tipo_telefono_referencia_key" ON "LeadDisparo"("empresaId", "tipo", "telefono", "referencia");

-- CreateIndex
CREATE INDEX "LeadBajaAvisos_empresaId_idx" ON "LeadBajaAvisos"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadBajaAvisos_empresaId_telefono_key" ON "LeadBajaAvisos"("empresaId", "telefono");

-- CreateIndex
CREATE INDEX "LeadEtapaHistorial_prospectoId_idx" ON "LeadEtapaHistorial"("prospectoId");

-- CreateIndex
CREATE INDEX "LeadEtapaHistorial_empresaId_hacia_idx" ON "LeadEtapaHistorial"("empresaId", "hacia");

-- CreateIndex
CREATE INDEX "LeadComprobantePago_empresaId_validadoEn_idx" ON "LeadComprobantePago"("empresaId", "validadoEn");

-- CreateIndex
CREATE INDEX "LeadComprobantePago_prospectoId_idx" ON "LeadComprobantePago"("prospectoId");

-- CreateIndex
CREATE INDEX "LeadConsulta_empresaId_tipo_creadoEn_idx" ON "LeadConsulta"("empresaId", "tipo", "creadoEn");

-- CreateIndex
CREATE INDEX "LeadConsulta_empresaId_hubo_idx" ON "LeadConsulta"("empresaId", "hubo");

-- CreateIndex
CREATE INDEX "LeadConsulta_telefono_idx" ON "LeadConsulta"("telefono");

-- CreateIndex
CREATE INDEX "EnvioDespacho_entregadoEn_idx" ON "EnvioDespacho"("entregadoEn");

-- AddForeignKey
ALTER TABLE "EvidenciaEntrega" ADD CONSTRAINT "EvidenciaEntrega_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "EnvioDespacho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDisparo" ADD CONSTRAINT "LeadDisparo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEtapaHistorial" ADD CONSTRAINT "LeadEtapaHistorial_prospectoId_fkey" FOREIGN KEY ("prospectoId") REFERENCES "LeadProspecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadComprobantePago" ADD CONSTRAINT "LeadComprobantePago_prospectoId_fkey" FOREIGN KEY ("prospectoId") REFERENCES "LeadProspecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadConsulta" ADD CONSTRAINT "LeadConsulta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

