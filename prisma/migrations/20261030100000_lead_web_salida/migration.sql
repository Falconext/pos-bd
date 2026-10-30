-- CreateTable
CREATE TABLE "LeadWebSalida" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "conversacionId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT,
    "url" TEXT,
    "productoId" INTEGER,
    "opcionesJson" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadWebSalida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadWebSalida_conversacionId_id_idx" ON "LeadWebSalida"("conversacionId", "id");

-- AddForeignKey
ALTER TABLE "LeadWebSalida" ADD CONSTRAINT "LeadWebSalida_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "LeadConversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
