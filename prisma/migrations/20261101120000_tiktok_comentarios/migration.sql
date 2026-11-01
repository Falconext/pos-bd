-- TikTok: respuestas de la IA a comentarios de videos.
ALTER TABLE "Empresa"
  ADD COLUMN "tiktokOpenId" TEXT,
  ADD COLUMN "tiktokUsername" TEXT,
  ADD COLUMN "tiktokToken" TEXT,
  ADD COLUMN "tiktokTokenExpira" TIMESTAMP(3),
  ADD COLUMN "tiktokRefreshToken" TEXT,
  ADD COLUMN "tiktokRefreshExpira" TIMESTAMP(3),
  ADD COLUMN "tiktokActivo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tiktokErrorToken" TEXT,
  ADD COLUMN "tiktokComentarios" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tiktokComentariosClave" TEXT,
  ADD COLUMN "tiktokComentariosDesde" TIMESTAMP(3);

CREATE UNIQUE INDEX "Empresa_tiktokOpenId_key" ON "Empresa"("tiktokOpenId");

CREATE TABLE "TiktokComentario" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "comentarioId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "autor" TEXT,
    "texto" TEXT NOT NULL,
    "respuesta" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "error" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TiktokComentario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokComentario_empresaId_comentarioId_key" ON "TiktokComentario"("empresaId", "comentarioId");
CREATE INDEX "TiktokComentario_empresaId_creadoEn_idx" ON "TiktokComentario"("empresaId", "creadoEn");

ALTER TABLE "TiktokComentario" ADD CONSTRAINT "TiktokComentario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
