-- Tope mensual de leads que atiende la IA de Ventas por plan. ADITIVA (nullable).
ALTER TABLE "Plan" ADD COLUMN "maxLeadsMes" INTEGER;
