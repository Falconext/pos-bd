/**
 * Verifica el costeo por sede contra TODOS los productos multi-sede de una
 * base de datos: simula una compra cara en una sede y una venta en otra, que
 * es la combinación que rompe la identidad si algo está mal, y restaura el
 * estado original de cada producto al terminar.
 *
 * Nació de un defecto que ningún escenario inventado mostraba: hacía falta un
 * producto con stock ya repartido en varias sedes desde antes de existir la
 * columna. Conviene correrlo antes de desplegar, contra una copia de los
 * datos reales.
 *
 *   DATABASE_URL_VERIFICACION="postgresql://postgres:developer@localhost:5432/sistema_mype" \
 *     npx ts-node -T --compiler-options '{"module":"commonjs"}' scripts/verificar-costo-sede.ts
 *
 * Escribe y revierte, así que se niega a correr contra una base remota.
 */
import { PrismaClient } from '@prisma/client';
import { KardexService } from '../src/kardex/kardex.service';

const URL = process.env.DATABASE_URL_VERIFICACION;
if (!URL) {
  console.error('Falta DATABASE_URL_VERIFICACION.');
  process.exit(1);
}
// Este script modifica filas antes de revertirlas: una interrupción a mitad
// dejaría datos a medio camino. Solo contra una base local.
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(URL)) {
  console.error(
    'Esta base no es local. El script escribe y revierte: no corre contra producción.',
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const n = (v: any) => Number(v ?? 0);

(async () => {
  const kardex = new KardexService(prisma as any, {} as any, {} as any);

  const objetivo: any[] = await prisma.$queryRawUnsafe(`
    select ps."productoId" as id
    from "ProductoStock" ps
    group by ps."productoId"
    having count(*) >= 2 and sum(case when ps.stock > 0 then 1 else 0 end) >= 2`);

  console.log('productos multi-sede con stock en 2+ sedes:', objetivo.length);

  let revisados = 0,
    descuadres = 0,
    negativos = 0,
    inflados = 0;
  const ejemplos: string[] = [];

  for (const { id: productoId } of objetivo) {
    const filasAntes = await prisma.productoStock.findMany({
      where: { productoId },
      select: { sedeId: true, stock: true, costoPromedio: true },
    });
    const prodAntes = await prisma.producto.findUnique({
      where: { id: productoId },
      select: { stock: true, costoPromedio: true },
    });
    const globalAntes = n(prodAntes?.costoPromedio);

    const conStock = filasAntes.filter((f) => n(f.stock) > 0);
    const sede = conStock[0].sedeId;
    // Compra cara, para forzar la divergencia entre sedes.
    const costoCompra = globalAntes > 0 ? globalAntes * 1.8 : 100;

    try {
      await (kardex as any).actualizarStockYCosto(
        productoId,
        sede,
        n(conStock[0].stock) + 7,
        'INGRESO',
        costoCompra,
        7,
      );
      // Y una venta en OTRA sede, que es lo que rompía la identidad.
      const otra = conStock[1];
      await (kardex as any).actualizarStockYCosto(
        productoId,
        otra.sedeId,
        Math.max(0, n(otra.stock) - 2),
        'SALIDA',
        undefined,
        2,
      );

      const filas = await prisma.productoStock.findMany({
        where: { productoId },
        select: { stock: true, costoPromedio: true },
      });
      const prod = await prisma.producto.findUnique({
        where: { id: productoId },
        select: { stock: true, costoPromedio: true },
      });
      const globalDespues = n(prod?.costoPromedio);

      const porSedes = filas.reduce(
        (t, f) =>
          t +
          n(f.stock) *
            (f.costoPromedio == null ? globalDespues : n(f.costoPromedio)),
        0,
      );
      const global = n(prod?.stock) * globalDespues;

      revisados++;
      if (Math.abs(porSedes - global) > 0.05) {
        descuadres++;
        if (ejemplos.length < 5)
          ejemplos.push(
            `  producto ${productoId}: descuadre S/${Math.abs(porSedes - global).toFixed(2)}`,
          );
      }
      if (
        globalDespues < 0 ||
        filas.some((f) => f.costoPromedio != null && n(f.costoPromedio) < 0)
      ) {
        negativos++;
        if (ejemplos.length < 5)
          ejemplos.push(`  producto ${productoId}: costo negativo`);
      }
      // El global no puede superar el costo más caro que se pagó nunca.
      const techo = Math.max(globalAntes, costoCompra);
      if (globalDespues > techo + 0.01) {
        inflados++;
        if (ejemplos.length < 5)
          ejemplos.push(
            `  producto ${productoId}: global ${globalDespues.toFixed(2)} > techo ${techo.toFixed(2)}`,
          );
      }
    } finally {
      for (const f of filasAntes) {
        await prisma.productoStock.update({
          where: { productoId_sedeId: { productoId, sedeId: f.sedeId } },
          data: { stock: f.stock, costoPromedio: f.costoPromedio },
        });
      }
      await prisma.producto.update({
        where: { id: productoId },
        data: {
          stock: prodAntes!.stock,
          costoPromedio: prodAntes!.costoPromedio,
        },
      });
    }
  }

  console.log('revisados          :', revisados);
  console.log('DESCUADRES         :', descuadres);
  console.log('COSTOS NEGATIVOS   :', negativos);
  console.log('COSTOS INFLADOS    :', inflados);
  if (ejemplos.length) console.log(ejemplos.join('\n'));

  const quedaron = await prisma.productoStock.count({
    where: { costoPromedio: { not: null } },
  });
  console.log('filas reales que quedaron tocadas:', quedaron);
  await prisma.$disconnect();
})();
