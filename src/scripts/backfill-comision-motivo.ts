/**
 * Backfill del campo ComisionVendedor.motivo para comisiones históricas (motivo = NULL).
 *
 * El motivo se llena automáticamente al crear comisiones nuevas (ver
 * ComisionesService.registrarComisionesDesdeComprobante). Este script reconstruye
 * el motivo de las comisiones ya existentes replicando la misma cascada de prioridad:
 *   1) comisión fija del producto   2) % del producto
 *   3) comisión fija global vendedor 4) % global vendedor
 *   (+ fila productoId = null -> comisión fija por venta/ticket)
 *
 * Idempotente: solo toca filas con motivo = NULL. Seguro de re-ejecutar.
 * Uso:  npx ts-node src/scripts/backfill-comision-motivo.ts
 *
 * Nota: para las comisiones por porcentaje el precio unitario se reconstruye a partir
 * del monto (monto ÷ (%·cantidad)); puede diferir en céntimos por redondeo. Las
 * comisiones nuevas guardan el precio exacto usado al emitir.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const n = (v: unknown): number => Number((v as any) ?? 0);

async function main() {
  const pendientes = await prisma.comisionVendedor.count({ where: { motivo: null } });
  console.log(`🔎 Comisiones sin motivo: ${pendientes}`);
  if (pendientes === 0) {
    console.log('✅ Nada que rellenar.');
    return;
  }

  const rows = await prisma.comisionVendedor.findMany({
    where: { motivo: null },
    select: { id: true, productoId: true, cantidad: true, montoComision: true, vendedorId: true },
  });

  const prodIds = [...new Set(rows.map((r) => r.productoId).filter((x): x is number => x != null))];
  const vendIds = [...new Set(rows.map((r) => r.vendedorId))];

  const prods = new Map(
    (
      await prisma.producto.findMany({
        where: { id: { in: prodIds } },
        select: { id: true, comisionPorVenta: true, comisionPorcentaje: true },
      })
    ).map((p) => [p.id, p]),
  );
  const vends = new Map(
    (
      await prisma.usuario.findMany({
        where: { id: { in: vendIds } },
        select: { id: true, comisionGlobal: true, comisionGlobalFija: true, comisionGlobalVenta: true },
      })
    ).map((u) => [u.id, u]),
  );

  let updated = 0;
  for (const r of rows) {
    const cant = n(r.cantidad);
    const monto = n(r.montoComision);
    let motivo: string;

    if (r.productoId == null) {
      motivo = `Comisión fija por venta/ticket del vendedor: S/ ${monto.toFixed(2)} (una vez por comprobante)`;
    } else {
      const p = prods.get(r.productoId);
      const v = vends.get(r.vendedorId);
      const cpv = n(p?.comisionPorVenta);
      const cpc = n(p?.comisionPorcentaje);
      const gFija = n(v?.comisionGlobalFija);
      const gPct = n(v?.comisionGlobal);

      if (cpv > 0) {
        motivo = `Comisión fija del producto: S/ ${cpv.toFixed(2)} × ${cant} und.`;
      } else if (cpc > 0) {
        const precio = cant > 0 ? monto / ((cpc / 100) * cant) : 0;
        motivo = `Comisión del producto: ${cpc}% del precio (S/ ${precio.toFixed(2)}) × ${cant} und.`;
      } else if (gFija > 0) {
        motivo = `Comisión global fija del vendedor: S/ ${gFija.toFixed(2)} × ${cant} und.`;
      } else if (gPct > 0) {
        const precio = cant > 0 ? monto / ((gPct / 100) * cant) : 0;
        motivo = `Comisión global del vendedor: ${gPct}% del precio (S/ ${precio.toFixed(2)}) × ${cant} und.`;
      } else {
        motivo = 'Comisión registrada (regla no determinada)';
      }
    }

    await prisma.comisionVendedor.update({ where: { id: r.id }, data: { motivo } });
    updated++;
    if (updated % 200 === 0) console.log(`  ...${updated}/${rows.length}`);
  }

  console.log(`✅ Backfill completo: ${updated} comisiones actualizadas.`);
}

main()
  .catch((e) => {
    console.error('❌ Error en backfill de motivo:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
