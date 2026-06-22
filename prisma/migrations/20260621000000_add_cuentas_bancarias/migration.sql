-- CreateTable CuentaBancaria (idempotente)
CREATE TABLE IF NOT EXISTS "CuentaBancaria" (
    "id"           SERIAL NOT NULL,
    "empresaId"    INTEGER NOT NULL,
    "banco"        TEXT NOT NULL,
    "numeroCuenta" TEXT NOT NULL,
    "cci"          TEXT,
    "tipoCuenta"   TEXT NOT NULL DEFAULT 'AHORROS',
    "moneda"       TEXT NOT NULL DEFAULT 'PEN',
    "alias"        TEXT,
    "activo"       BOOLEAN NOT NULL DEFAULT true,
    "creadoEn"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaBancaria_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey CuentaBancaria -> Empresa (idempotente)
DO $$ BEGIN
  ALTER TABLE "CuentaBancaria" ADD CONSTRAINT "CuentaBancaria_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex (idempotente)
CREATE INDEX IF NOT EXISTS "CuentaBancaria_empresaId_idx" ON "CuentaBancaria"("empresaId");

-- AlterTable Pago: agregar cuentaBancariaId (idempotente)
DO $$ BEGIN
  ALTER TABLE "Pago" ADD COLUMN "cuentaBancariaId" INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- AddForeignKey Pago -> CuentaBancaria (idempotente)
DO $$ BEGIN
  ALTER TABLE "Pago" ADD CONSTRAINT "Pago_cuentaBancariaId_fkey"
    FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex Pago.cuentaBancariaId (idempotente)
CREATE INDEX IF NOT EXISTS "Pago_cuentaBancariaId_idx" ON "Pago"("cuentaBancariaId");
