/**
 * LIMPIEZA — pagos de adelanto duplicados por la coordinación de envío.
 *
 * Al guardar una nota de venta (o NP/OT/TICKET/CP/RH) con adelanto y envío, el
 * adelanto se registraba DOS veces:
 *   1. `comprobante.service` → observación "Pago registrado al emitir <doc>"
 *   2. `envio-despacho.service` → referencia "<tipoDoc>-ENVIO-<id>"
 *
 * El limpiador que ya existía en envio-despacho buscaba por texto exacto de la
 * observación y la de emisión es distinta, así que nunca borraba nada. Resultado:
 * el Historial de Pagos mostraba el adelanto dos veces y el total pagado salía al
 * doble. El comprobante en sí (adelanto/saldo) siempre estuvo bien.
 *
 * Ya está corregido en el código; este script arregla los que quedaron.
 *
 * Criterio conservador — solo se borra el pago de ENVÍO cuando:
 *   · el comprobante tiene otro pago que NO es de envío, y
 *   · la suma de pagos supera el adelanto del comprobante, y
 *   · borrarlo deja la suma <= adelanto (nunca deja al comprobante con menos
 *     pagos de los que le corresponden).
 * Cualquier caso que no encaje se reporta y se deja intacto.
 *
 * Uso:
 *   npx ts-node src/scripts/limpiar-pagos-duplicados-envio.ts           → solo reporta
 *   npx ts-node src/scripts/limpiar-pagos-duplicados-envio.ts --aplicar → borra
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  console.log(
    `\n${APLICAR ? '✍️  MODO ESCRITURA' : '👀 SOLO LECTURA (agrega --aplicar para borrar)'}`,
  );
  console.log(`   Base de datos: ${url.replace(/^.*@/, '').split('/')[0]}\n`);

  const pagosEnvio = await prisma.pago.findMany({
    where: { referencia: { contains: '-ENVIO-' } },
    select: { id: true, comprobanteId: true, monto: true },
  });
  const comprobanteIds = [...new Set(pagosEnvio.map((p) => p.comprobanteId))];

  interface PagoRespaldo {
    pagoId: number;
    comprobanteId: number;
    doc: string;
    empresaId: number;
    monto: number;
    referencia: string | null;
    observacion: string | null;
  }
  interface Fila {
    empresa: string;
    razonSocial: string;
    comprobantes: number;
    montoFantasma: number;
  }

  const aBorrar: number[] = [];
  const respaldo: PagoRespaldo[] = [];
  const omitidos: Array<{ doc: string; motivo: string }> = [];
  const porEmpresa: Record<string, { n: number; monto: number }> = {};

  for (const comprobanteId of comprobanteIds) {
    if (comprobanteId == null) continue;
    const comp = await prisma.comprobante.findUnique({
      where: { id: comprobanteId },
      select: {
        id: true,
        serie: true,
        correlativo: true,
        empresaId: true,
        adelanto: true,
        mtoImpVenta: true,
      },
    });
    if (!comp) continue;

    const pagos = await prisma.pago.findMany({
      where: { comprobanteId },
      select: { id: true, monto: true, referencia: true, observacion: true },
      orderBy: { id: 'asc' },
    });
    const suma = r2(pagos.reduce((a, x) => a + Number(x.monto), 0));
    const adelanto = r2(Number(comp.adelanto ?? 0));
    const deEnvio = pagos.filter((x) => x.referencia?.includes('-ENVIO-'));
    const otros = pagos.filter((x) => !x.referencia?.includes('-ENVIO-'));

    const doc = `${comp.serie}-${comp.correlativo}`;

    // Nada que corregir: la suma no excede el adelanto.
    if (suma <= adelanto) continue;
    // Sin otro pago, el de envío es el único registro del adelanto: no se toca.
    if (otros.length === 0 || deEnvio.length === 0) {
      omitidos.push({
        doc,
        motivo: 'el pago de envío es el único del adelanto',
      });
      continue;
    }

    const montoEnvio = r2(deEnvio.reduce((a, x) => a + Number(x.monto), 0));
    const sumaSinEnvio = r2(suma - montoEnvio);
    // Borrar no debe dejar al comprobante con menos de lo que se adelantó.
    if (sumaSinEnvio < adelanto) {
      omitidos.push({
        doc,
        motivo: `borrarlo dejaría ${sumaSinEnvio} < adelanto ${adelanto}`,
      });
      continue;
    }

    for (const pg of deEnvio) {
      aBorrar.push(pg.id);
      respaldo.push({
        pagoId: pg.id,
        comprobanteId,
        doc,
        empresaId: comp.empresaId,
        monto: Number(pg.monto),
        referencia: pg.referencia,
        observacion: pg.observacion,
      });
    }
    const k = String(comp.empresaId);
    porEmpresa[k] = porEmpresa[k] || { n: 0, monto: 0 };
    porEmpresa[k].n++;
    porEmpresa[k].monto = r2(porEmpresa[k].monto + montoEnvio);
  }

  const filas: Fila[] = [];
  for (const [empresaId, v] of Object.entries(porEmpresa)) {
    const e = await prisma.empresa.findUnique({
      where: { id: Number(empresaId) },
      select: { razonSocial: true },
    });
    filas.push({
      empresa: empresaId,
      razonSocial: (e?.razonSocial ?? '').slice(0, 32),
      comprobantes: v.n,
      montoFantasma: v.monto,
    });
  }
  filas.sort((a, b) => b.comprobantes - a.comprobantes);
  console.table(filas);
  console.log(`   Pagos duplicados a eliminar: ${aBorrar.length}`);
  console.log(
    `   Monto fantasma total: S/ ${r2(respaldo.reduce((a, x) => a + x.monto, 0))}`,
  );
  if (omitidos.length) {
    console.log(`\n   ⚠️  Omitidos (se dejan intactos): ${omitidos.length}`);
    omitidos
      .slice(0, 10)
      .forEach((o) => console.log(`      ${o.doc}: ${o.motivo}`));
    if (omitidos.length > 10)
      console.log(`      … y ${omitidos.length - 10} más`);
  }

  if (!APLICAR) {
    console.log('\n   Nada se borró. Volver a correr con --aplicar.\n');
    return;
  }

  const ruta = `pagos-duplicados-respaldo-${Date.now()}.json`;
  fs.writeFileSync(ruta, JSON.stringify(respaldo, null, 2));
  console.log(`\n   💾 Respaldo de los pagos a borrar: ${ruta}`);

  const del = await prisma.pago.deleteMany({ where: { id: { in: aBorrar } } });
  console.log(`   ✅ Pagos eliminados: ${del.count}`);

  const quedan = await prisma.pago.count({
    where: { referencia: { contains: '-ENVIO-' } },
  });
  console.log(`   Pagos de envío que quedan (legítimos): ${quedan}\n`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
