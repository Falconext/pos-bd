-- Opt-in por empresa del rastreo automático Shalom (cron 30 min).
-- ADITIVA: con default false, al desplegar el cron NO toca a ninguna empresa
-- hasta que se active explícitamente (evita enviar WhatsApp a clientes sin aviso).
ALTER TABLE "Empresa" ADD COLUMN "shalomAutoTrackingActivo" BOOLEAN NOT NULL DEFAULT false;
