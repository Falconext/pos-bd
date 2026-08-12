-- Explicación legible de por qué se generó cada comisión (la regla de la cascada
-- que la disparó: fija de producto / % de producto / fija global / % global / fija por venta).
-- Se llena automáticamente al crear cada comisión nueva. Para las comisiones
-- históricas (motivo = NULL) ejecutar: npx ts-node src/scripts/backfill-comision-motivo.ts
ALTER TABLE "ComisionVendedor" ADD COLUMN IF NOT EXISTS "motivo" TEXT;
