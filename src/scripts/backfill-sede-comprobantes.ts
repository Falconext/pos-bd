/**
 * BACKFILL — sede de los comprobantes huérfanos.
 *
 * `Comprobante.sedeId` se añadió con el refactor multi-sede, pero el script de
 * esa migración (migrate-sedes.ts) solo creó las sedes y migró el stock: las
 * ventas ya emitidas quedaron con `sedeId = null`. Esas ventas no aparecen en
 * ninguna vista por sede del Análisis Financiero — solo en "Todas las sedes" —
 * así que un usuario asignado a una sede vería menos ventas de las que hubo.
 *
 * Las ventas nuevas ya nacen con su sede (se toma del JWT de quien emite), por
 * lo que esto se corre UNA vez y no vuelve a hacer falta.
 *
 * Criterio: los huérfanos se asignan a la SEDE PRINCIPAL de su empresa.
 *
 * Uso:
 *   npx ts-node src/scripts/backfill-sede-comprobantes.ts           → solo reporta
 *   npx ts-node src/scripts/backfill-sede-comprobantes.ts --aplicar → escribe
 *
 * Es idempotente: solo toca filas con `sedeId` null.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APLICAR = process.argv.includes('--aplicar');

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/^.*@/, '').split('/')[0] || '(desconocido)';
  console.log(
    `\n${APLICAR ? '✍️  MODO ESCRITURA' : '👀 SOLO LECTURA (agrega --aplicar para escribir)'}`,
  );
  console.log(`   Base de datos: ${host}\n`);

  const totalHuerfanos = await prisma.comprobante.count({
    where: { sedeId: null },
  });
  if (totalHuerfanos === 0) {
    console.log('✅ No hay comprobantes sin sede. Nada que hacer.\n');
    return;
  }

  const empresas = await prisma.empresa.findMany({
    select: {
      id: true,
      razonSocial: true,
      sedes: {
        select: { id: true, nombre: true, esPrincipal: true, activo: true },
      },
    },
  });

  let actualizados = 0;
  let sinSedePrincipal = 0;
  let omitidasParaRevision = 0;
  const filas: Array<Record<string, any>> = [];

  for (const empresa of empresas) {
    const huerfanos = await prisma.comprobante.count({
      where: { empresaId: empresa.id, sedeId: null },
    });
    if (huerfanos === 0) continue;

    // Sede destino: la principal; si no hay ninguna marcada, la primera activa.
    const principal =
      empresa.sedes.find((s) => s.esPrincipal) ??
      empresa.sedes.find((s) => s.activo) ??
      empresa.sedes[0];

    if (!principal) {
      // Sin sedes no hay a dónde asignarlos: se reporta y se deja intacto.
      sinSedePrincipal += huerfanos;
      filas.push({
        empresa: empresa.id,
        razonSocial: empresa.razonSocial.slice(0, 30),
        huerfanos,
        destino: '⚠️ SIN SEDES — se omite',
      });
      continue;
    }

    // Guarda de seguridad: si la empresa tiene VARIAS sedes y la sede destino no
    // tiene ni un comprobante asignado, la marca de "principal" es sospechosa
    // (cuentas que quedaron con sedes de prueba, o la principal real sin marcar).
    // Asignar ahí partiría el reporte de esa empresa en dos, así que se omite y
    // se reporta para revisarla a mano.
    if (empresa.sedes.length > 1) {
      const yaAsignados = await prisma.comprobante.count({
        where: { empresaId: empresa.id, sedeId: principal.id },
      });
      if (yaAsignados === 0) {
        omitidasParaRevision += huerfanos;
        filas.push({
          empresa: empresa.id,
          razonSocial: empresa.razonSocial.slice(0, 30),
          huerfanos,
          destino: `⚠️ REVISAR — "${principal.nombre}" no tiene comprobantes`,
        });
        continue;
      }
    }

    filas.push({
      empresa: empresa.id,
      razonSocial: empresa.razonSocial.slice(0, 30),
      huerfanos,
      destino: `${principal.nombre} (id ${principal.id})`,
    });

    if (APLICAR) {
      const r = await prisma.comprobante.updateMany({
        where: { empresaId: empresa.id, sedeId: null },
        data: { sedeId: principal.id },
      });
      actualizados += r.count;
    }
  }

  console.table(filas);
  console.log(`   Comprobantes sin sede encontrados: ${totalHuerfanos}`);
  if (sinSedePrincipal > 0) {
    console.log(
      `   ⚠️  Omitidos por no tener ninguna sede: ${sinSedePrincipal}`,
    );
  }
  if (omitidasParaRevision > 0) {
    console.log(
      `   ⚠️  Omitidos para revisión manual (sede principal sin comprobantes): ${omitidasParaRevision}`,
    );
  }
  if (APLICAR) {
    console.log(`   ✅ Actualizados: ${actualizados}`);
    const quedan = await prisma.comprobante.count({ where: { sedeId: null } });
    console.log(`   Quedan sin sede: ${quedan}`);
  } else {
    console.log('\n   Nada se escribió. Volver a correr con --aplicar.');
  }

  // Los movimientos de caja tienen el mismo problema y afectan los gastos por
  // sede. Solo se informa: este script no los toca.
  const cajaHuerfana = await prisma.movimientoCaja.count({
    where: { sedeId: null },
  });
  if (cajaHuerfana > 0) {
    console.log(
      `\n   ℹ️  Además hay ${cajaHuerfana} movimiento(s) de caja sin sede. Este script NO los toca.`,
    );
  }
  console.log();
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
