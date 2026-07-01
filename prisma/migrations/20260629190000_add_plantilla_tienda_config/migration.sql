CREATE TABLE "PlantillaTiendaConfig" (
    "id" TEXT NOT NULL,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "precioSoles" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "premiumNote" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantillaTiendaConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlantillaTiendaConfig" ("id", "premium", "precioSoles", "premiumNote", "actualizadoEn")
VALUES ('maye', true, 199, 'Compra única aparte del plan', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
