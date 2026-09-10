/**
 * BACKFILL — comisiones de las ventas atascadas en PENDIENTE_CONCILIACION.
 *
 * Ese estado se pone cuando SUNAT responde que el documento YA ESTÁ REGISTRADO
 * (código 1033) pero el CDR no llegó. La venta es válida y aceptada: lo único
 * que falta es el papel. Sin embargo la comisión solo se generaba al conciliar
 * a mano, y como casi nadie concilia, el vendedor no cobraba nunca esas ventas.
 *
 * Ya está corregido en el código (`marcarPendienteConciliacionSunat` y el
 * scheduler generan la comisión al marcar el estado); este script arregla las
 * que quedaron.
 *
 * Solo toca facturas (01) y boletas (03), que son las únicas que comisionan, y
 * reutiliza `registrarComisionesAlAceptar`, que es idempotente y respeta el
 * anti-doble cobro cuando la venta viene de un informal que ya comisionó.
 *
 * Uso:
 *   npx ts-node src/scripts/comisiones-pendiente-conciliacion.ts           → reporta
 *   npx ts-node src/scripts/comisiones-pendiente-conciliacion.ts --aplicar → genera
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { EnviarSunatService } from '../comprobante/enviar-sunat.service';

const APLICAR = process.argv.includes('--aplicar');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const prisma = app.get(PrismaService);
  const enviarSunat = app.get(EnviarSunatService);

  const url = process.env.DATABASE_URL ?? '';
  console.log(
    `\n${APLICAR ? '✍️  MODO ESCRITURA' : '👀 SOLO LECTURA (agrega --aplicar para generar)'}`,
  );
  console.log(`   Base de datos: ${url.replace(/^.*@/, '').split('/')[0]}\n`);

  const pendientes = await prisma.comprobante.findMany({
    where: {
      estadoEnvioSunat: 'PENDIENTE_CONCILIACION' as any,
      tipoDoc: { in: ['01', '03'] },
    },
    include: { detalles: true },
    orderBy: { id: 'asc' },
  });

  const filas: Array<Record<string, unknown>> = [];
  const sinComision: typeof pendientes = [];

  for (const comp of pendientes) {
    const yaTiene = await prisma.comisionVendedor.count({
      where: { comprobanteId: comp.id },
    });
    const vendedorId = comp.vendedorCampoId ?? comp.usuarioId;
    if (yaTiene > 0) continue;
    sinComision.push(comp);
    filas.push({
      doc: `${comp.serie}-${comp.correlativo}`,
      empresa: comp.empresaId,
      total: Number(comp.mtoImpVenta),
      vendedorId: vendedorId ?? '⚠️ sin vendedor',
      fecha: comp.fechaEmision?.toISOString().slice(0, 10),
    });
  }

  if (filas.length === 0) {
    console.log('✅ No hay ventas en conciliación sin comisión.\n');
    await app.close();
    return;
  }
  console.table(filas);
  console.log(`   Ventas sin comisión: ${sinComision.length}`);
  console.log(
    `   Monto vendido: S/ ${sinComision.reduce((a, c) => a + Number(c.mtoImpVenta), 0).toFixed(2)}`,
  );

  if (!APLICAR) {
    console.log('\n   Nada se generó. Volver a correr con --aplicar.\n');
    await app.close();
    return;
  }

  let generadas = 0;
  for (const comp of sinComision) {
    await enviarSunat.registrarComisionesAlAceptar(comp);
    const n = await prisma.comisionVendedor.count({
      where: { comprobanteId: comp.id },
    });
    if (n > 0) generadas++;
  }
  console.log(`\n   ✅ Ventas con comisión generada: ${generadas}`);
  console.log(
    `   Sin generar (sin vendedor, o venían de un informal que ya comisionó): ${sinComision.length - generadas}\n`,
  );
  await app.close();
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
