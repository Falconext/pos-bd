-- CreateTable: GuiaRemision (tipoGuia column added in subsequent migration add_tipo_guia_remision)
CREATE TABLE IF NOT EXISTS "GuiaRemision" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "serie" TEXT NOT NULL,
    "correlativo" INTEGER NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "horaEmision" TEXT,
    "tipoDocumento" TEXT NOT NULL DEFAULT '09',
    "remitenteRuc" TEXT NOT NULL,
    "remitenteRazonSocial" TEXT NOT NULL,
    "remitenteDireccion" TEXT NOT NULL,
    "destinatarioTipoDoc" TEXT NOT NULL,
    "destinatarioNumDoc" TEXT NOT NULL,
    "destinatarioRazonSocial" TEXT NOT NULL,
    "tipoTraslado" TEXT NOT NULL,
    "modoTransporte" TEXT NOT NULL,
    "pesoTotal" DECIMAL(65,30) NOT NULL,
    "unidadPeso" TEXT NOT NULL DEFAULT 'KGM',
    "transportistaRuc" TEXT,
    "transportistaRazonSocial" TEXT,
    "transportistaMTC" TEXT,
    "conductorTipoDoc" TEXT,
    "conductorNumDoc" TEXT,
    "conductorNombre" TEXT,
    "conductorApellidos" TEXT,
    "conductorLicencia" TEXT,
    "vehiculoPlaca" TEXT,
    "vehiculoAutorizacion" TEXT,
    "partidaUbigeo" TEXT NOT NULL,
    "partidaDireccion" TEXT NOT NULL,
    "partidaCodigoEstablecimiento" TEXT,
    "llegadaUbigeo" TEXT NOT NULL,
    "llegadaDireccion" TEXT NOT NULL,
    "llegadaCodigoEstablecimiento" TEXT,
    "fechaInicioTraslado" TIMESTAMP(3) NOT NULL,
    "retornoVehiculoVacio" BOOLEAN NOT NULL DEFAULT false,
    "retornoEnvasesVacios" BOOLEAN NOT NULL DEFAULT false,
    "transbordoProgramado" BOOLEAN NOT NULL DEFAULT false,
    "trasladoTotal" BOOLEAN NOT NULL DEFAULT false,
    "vehiculoM1oL" BOOLEAN NOT NULL DEFAULT false,
    "datosTransportista" BOOLEAN NOT NULL DEFAULT false,
    "estadoSunat" "EstadoSunat" NOT NULL DEFAULT 'PENDIENTE',
    "sunatXml" TEXT,
    "sunatCdrResponse" TEXT,
    "sunatCdrZip" TEXT,
    "sunatErrorMsg" TEXT,
    "documentoId" TEXT,
    "s3XmlUrl" TEXT,
    "s3CdrUrl" TEXT,
    "s3PdfUrl" TEXT,
    "observaciones" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER,
    "clienteId" INTEGER,
    "sedeId" INTEGER,

    CONSTRAINT "GuiaRemision_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DetalleGuiaRemision
CREATE TABLE IF NOT EXISTS "DetalleGuiaRemision" (
    "id" SERIAL NOT NULL,
    "guiaRemisionId" INTEGER NOT NULL,
    "numeroOrden" INTEGER NOT NULL,
    "productoId" INTEGER,
    "codigoProducto" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(65,30) NOT NULL,
    "unidadMedida" TEXT NOT NULL DEFAULT 'NIU',

    CONSTRAINT "DetalleGuiaRemision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GuiaRemision_empresaId_serie_correlativo_key" ON "GuiaRemision"("empresaId", "serie", "correlativo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GuiaRemision_empresaId_fechaEmision_idx" ON "GuiaRemision"("empresaId", "fechaEmision");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GuiaRemision_estadoSunat_idx" ON "GuiaRemision"("estadoSunat");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DetalleGuiaRemision_guiaRemisionId_idx" ON "DetalleGuiaRemision"("guiaRemisionId");

-- AddForeignKey (idempotent via exception handler for production DB where constraints may already exist)
DO $$ BEGIN
    ALTER TABLE "GuiaRemision" ADD CONSTRAINT "GuiaRemision_empresaId_fkey"
        FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "GuiaRemision" ADD CONSTRAINT "GuiaRemision_usuarioId_fkey"
        FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "GuiaRemision" ADD CONSTRAINT "GuiaRemision_clienteId_fkey"
        FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- NOTE: GuiaRemision.sedeId FK omitted — Sede has no creation migration; FK captured in future reconciliation migration.

DO $$ BEGIN
    ALTER TABLE "DetalleGuiaRemision" ADD CONSTRAINT "DetalleGuiaRemision_guiaRemisionId_fkey"
        FOREIGN KEY ("guiaRemisionId") REFERENCES "GuiaRemision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "DetalleGuiaRemision" ADD CONSTRAINT "DetalleGuiaRemision_productoId_fkey"
        FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add guiaRemisionId to WhatsAppEnvio (column may already exist in production)
ALTER TABLE "WhatsAppEnvio" ADD COLUMN IF NOT EXISTS "guiaRemisionId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppEnvio_guiaRemisionId_idx" ON "WhatsAppEnvio"("guiaRemisionId");

DO $$ BEGIN
    ALTER TABLE "WhatsAppEnvio" ADD CONSTRAINT "WhatsAppEnvio_guiaRemisionId_fkey"
        FOREIGN KEY ("guiaRemisionId") REFERENCES "GuiaRemision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Make WhatsAppEnvio.comprobanteId nullable (schema has Int? but original migration used NOT NULL)
ALTER TABLE "WhatsAppEnvio" ALTER COLUMN "comprobanteId" DROP NOT NULL;
