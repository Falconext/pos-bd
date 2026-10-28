-- Etiquetas de contactos de la IA de Ventas (base de los envíos masivos).
CREATE TABLE "LeadEtiqueta" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'gris',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEtiqueta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadConversacionEtiqueta" (
    "conversacionId" INTEGER NOT NULL,
    "etiquetaId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadConversacionEtiqueta_pkey" PRIMARY KEY ("conversacionId","etiquetaId")
);

CREATE UNIQUE INDEX "LeadEtiqueta_empresaId_nombre_key" ON "LeadEtiqueta"("empresaId", "nombre");
CREATE INDEX "LeadEtiqueta_empresaId_idx" ON "LeadEtiqueta"("empresaId");
CREATE INDEX "LeadConversacionEtiqueta_etiquetaId_idx" ON "LeadConversacionEtiqueta"("etiquetaId");

ALTER TABLE "LeadEtiqueta" ADD CONSTRAINT "LeadEtiqueta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadConversacionEtiqueta" ADD CONSTRAINT "LeadConversacionEtiqueta_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "LeadConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadConversacionEtiqueta" ADD CONSTRAINT "LeadConversacionEtiqueta_etiquetaId_fkey" FOREIGN KEY ("etiquetaId") REFERENCES "LeadEtiqueta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
