-- Guía de consumo (30-10): "cómo se toma" se escribe una vez por producto y la
-- guía que el negocio le envía a cada cliente queda guardada para la IA.
ALTER TABLE "Producto" ADD COLUMN "modoDeUso" TEXT;
ALTER TABLE "LeadProspecto" ADD COLUMN "guiaConsumo" TEXT;
ALTER TABLE "LeadProspecto" ADD COLUMN "guiaConsumoEn" TIMESTAMP(3);
