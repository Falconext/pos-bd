-- Último estado público avisado por webhook. Null = nunca se avisó.
ALTER TABLE "Comprobante" ADD COLUMN "apiEstadoNotificado" TEXT;
