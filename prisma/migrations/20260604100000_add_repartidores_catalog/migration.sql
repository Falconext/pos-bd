-- CreateEnum
CREATE TYPE "TipoRepartidor" AS ENUM ('PLANILLA', 'EVENTUAL');

-- CreateTable
CREATE TABLE "Repartidor" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "celular" TEXT,
    "tipo" "TipoRepartidor" NOT NULL DEFAULT 'EVENTUAL',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "empresaId" INTEGER NOT NULL,
    "sedeId" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repartidor_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "EnvioDespacho" ADD COLUMN "repartidorId" INTEGER;
ALTER TABLE "PedidoTienda" ADD COLUMN "repartidorId" INTEGER;

-- Data migration: free-text EnvioDespacho.repartidor -> Repartidor catalog (conditional).
-- Runs only if the legacy text column still exists (skipped in fresh shadow DBs).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'EnvioDespacho'
          AND column_name  = 'repartidor'
    ) THEN
        INSERT INTO "Repartidor" ("nombre", "empresaId", "sedeId", "tipo", "activo")
        SELECT
            TRIM(ed."repartidor") AS "nombre",
            c."empresaId"         AS "empresaId",
            MIN(c."sedeId")       AS "sedeId",
            'EVENTUAL'::"TipoRepartidor" AS "tipo",
            true                  AS "activo"
        FROM "EnvioDespacho" ed
        INNER JOIN "Comprobante" c ON c."id" = ed."comprobanteId"
        WHERE ed."repartidor" IS NOT NULL
          AND TRIM(ed."repartidor") <> ''
        GROUP BY c."empresaId", TRIM(ed."repartidor")
        ON CONFLICT DO NOTHING;

        UPDATE "EnvioDespacho" ed
        SET "repartidorId" = r."id"
        FROM "Comprobante" c
        JOIN "Repartidor" r ON r."empresaId" = c."empresaId"
                           AND r."nombre"    = TRIM(ed."repartidor")
        WHERE c."id" = ed."comprobanteId"
          AND ed."repartidor" IS NOT NULL
          AND TRIM(ed."repartidor") <> '';

        ALTER TABLE "EnvioDespacho" DROP COLUMN "repartidor";
    END IF;
END $$;

-- CreateIndex
CREATE INDEX "Repartidor_empresaId_activo_idx" ON "Repartidor"("empresaId", "activo");
CREATE INDEX "Repartidor_sedeId_idx" ON "Repartidor"("sedeId");
CREATE UNIQUE INDEX "Repartidor_empresaId_nombre_key" ON "Repartidor"("empresaId", "nombre");
CREATE INDEX "EnvioDespacho_repartidorId_idx" ON "EnvioDespacho"("repartidorId");
CREATE INDEX "PedidoTienda_repartidorId_idx" ON "PedidoTienda"("repartidorId");

-- AddForeignKey
ALTER TABLE "Repartidor" ADD CONSTRAINT "Repartidor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Repartidor" ADD CONSTRAINT "Repartidor_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EnvioDespacho" ADD CONSTRAINT "EnvioDespacho_repartidorId_fkey" FOREIGN KEY ("repartidorId") REFERENCES "Repartidor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PedidoTienda" ADD CONSTRAINT "PedidoTienda_repartidorId_fkey" FOREIGN KEY ("repartidorId") REFERENCES "Repartidor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
