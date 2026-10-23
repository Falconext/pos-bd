-- Recordatorio diario de recojo en agencia (opt-in por empresa).
ALTER TABLE "DespachoMensajeTemplate" ADD COLUMN "recordatorioRecojoDias" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EnvioDespacho" ADD COLUMN "recordatoriosRecojo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EnvioDespacho" ADD COLUMN "ultimoRecordatorioRecojoEn" TIMESTAMP(3);
