-- WhatsApp del negocio por QR con Evolution API propio (una instancia por empresa).
CREATE TYPE "EstadoWhatsappConexion" AS ENUM ('NO_CONECTADO', 'CONECTANDO', 'CONECTADO', 'DESCONECTADO');

CREATE TABLE "WhatsappConexion" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "instancia" TEXT NOT NULL,
    "tokenCifrado" TEXT,
    "estado" "EstadoWhatsappConexion" NOT NULL DEFAULT 'NO_CONECTADO',
    "numero" TEXT,
    "nombrePerfil" TEXT,
    "conectadoEn" TIMESTAMP(3),
    "desconectadoEn" TIMESTAMP(3),
    "avisoDesconexionEn" TIMESTAMP(3),
    "enviadosHoy" INTEGER NOT NULL DEFAULT 0,
    "enviadosDia" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsappConexion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappConexion_empresaId_key" ON "WhatsappConexion"("empresaId");
CREATE UNIQUE INDEX "WhatsappConexion_instancia_key" ON "WhatsappConexion"("instancia");

ALTER TABLE "WhatsappConexion" ADD CONSTRAINT "WhatsappConexion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
