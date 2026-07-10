-- CreateTable
CREATE TABLE "ApiKeyLogistica" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" TEXT,
    "entorno" TEXT NOT NULL DEFAULT 'live',
    "prefijo" TEXT NOT NULL,
    "ultimosCuatro" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoUsoEn" TIMESTAMP(3),
    "revocadaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKeyLogistica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpointLogistica" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "endpointId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventos" TEXT[],
    "secret" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoEnvioEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpointLogistica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyLogistica_hash_key" ON "ApiKeyLogistica"("hash");

-- CreateIndex
CREATE INDEX "ApiKeyLogistica_empresaId_idx" ON "ApiKeyLogistica"("empresaId");

-- CreateIndex
CREATE INDEX "ApiKeyLogistica_hash_idx" ON "ApiKeyLogistica"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpointLogistica_endpointId_key" ON "WebhookEndpointLogistica"("endpointId");

-- CreateIndex
CREATE INDEX "WebhookEndpointLogistica_empresaId_idx" ON "WebhookEndpointLogistica"("empresaId");

-- AddForeignKey
ALTER TABLE "ApiKeyLogistica" ADD CONSTRAINT "ApiKeyLogistica_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpointLogistica" ADD CONSTRAINT "WebhookEndpointLogistica_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

