-- Tipo de producto de Shalom elegido en la coordinación de envío. Nullable: los
-- despachos existentes siguen usando el default configurado.
ALTER TABLE "EnvioDespacho" ADD COLUMN "shalomTipoProducto" INTEGER;
