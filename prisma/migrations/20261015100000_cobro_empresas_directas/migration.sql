-- El ciclo de cobro de las empresas que le compran directo a Falconext.
--
-- Los clientes de reseller ya tenían su ciclo en "ResellerMovimiento" (se cobra
-- del saldo del reseller, con gracia y suspensión). Los directos no tenían
-- nada: vencían, alguien se acordaba de cobrarles por WhatsApp, y esa plata no
-- quedaba registrada — por eso el panel de finanzas solo sabía sumar el canal
-- reseller y mostraba el MRR teórico como si fuera lo cobrado.
--
-- El índice único (empresaId, periodo) es la pieza de seguridad: el cron corre
-- a diario, y sin él una semana de corridas serían siete mensualidades.

CREATE TABLE "CobroEmpresa" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "planNombre" TEXT,
    "monto" DECIMAL(10,2) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intento" INTEGER NOT NULL DEFAULT 1,
    "motivo" TEXT,
    "medioPago" TEXT,
    "referencia" TEXT,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "fechaCobro" TIMESTAMP(3),
    "cubreHasta" TIMESTAMP(3),
    "descripcion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CobroEmpresa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CobroEmpresa_empresaId_periodo_key" ON "CobroEmpresa"("empresaId", "periodo");
CREATE INDEX "CobroEmpresa_empresaId_estado_idx" ON "CobroEmpresa"("empresaId", "estado");
CREATE INDEX "CobroEmpresa_estado_fechaVencimiento_idx" ON "CobroEmpresa"("estado", "fechaVencimiento");

ALTER TABLE "CobroEmpresa" ADD CONSTRAINT "CobroEmpresa_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El ingreso de plataforma ahora sabe de qué empresa vino y qué cobro lo
-- originó. Ambas columnas son nullable: los ingresos cargados a mano (soporte,
-- personalizaciones) siguen existiendo sin empresa.
ALTER TABLE "IngresoSistema" ADD COLUMN IF NOT EXISTS "empresaId" INTEGER;
ALTER TABLE "IngresoSistema" ADD COLUMN IF NOT EXISTS "cobroEmpresaId" INTEGER;

-- Único: un cobro aplicado deja exactamente un ingreso. Registrar dos veces el
-- mismo pago falla en la base en vez de inflar el mes.
CREATE UNIQUE INDEX "IngresoSistema_cobroEmpresaId_key" ON "IngresoSistema"("cobroEmpresaId");
CREATE INDEX "IngresoSistema_empresaId_idx" ON "IngresoSistema"("empresaId");

ALTER TABLE "IngresoSistema" ADD CONSTRAINT "IngresoSistema_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IngresoSistema" ADD CONSTRAINT "IngresoSistema_cobroEmpresaId_fkey"
  FOREIGN KEY ("cobroEmpresaId") REFERENCES "CobroEmpresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
