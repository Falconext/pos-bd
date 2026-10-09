// Fuerza BD LOCAL antes de cargar nada (jamás Railway/prod).
process.env.DATABASE_URL =
  'postgresql://postgres:developer@localhost:5432/sistema_mype';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ComprobanteService } from '../src/comprobante/comprobante.service';
import { PrismaService } from '../src/prisma/prisma.service';
import * as fs from 'fs';
const RES = '/tmp/cot-e2e-result.txt';
fs.writeFileSync(RES, '');
const out = (...a: any[]) => fs.appendFileSync(RES, a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');

const EMPRESA = 23;
const DET = [
  { productoId: 8415, cantidad: 5 }, // Yogurt S/11 → 55
  { productoId: 8424, cantidad: 2 }, // Nuez moscada S/1 → 2   (total ~57)
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const comprobante = app.get(ComprobanteService);
  const prisma = app.get(PrismaService);

  const stockAntes = await prisma.producto.findUnique({
    where: { id: 8415 },
    select: { stock: true },
  });

  const input = {
    tipoDoc: 'COT',
    fechaEmision: new Date().toISOString(),
    formaPagoTipo: 'CONTADO',
    formaPagoMoneda: 'PEN',
    tipoMoneda: 'PEN',
    clienteName: 'CLIENTES VARIOS',
    leyenda: 'QA IA cotización (E2E)',
    observaciones: 'QA E2E — borrar luego',
    detalles: DET,
  };

  let comp: any;
  try {
    comp = await comprobante.crearInformal(input, EMPRESA);
  } catch (e: any) {
    out('❌ crearInformal FALLÓ:', e?.message || e);
    await app.close();
    process.exit(1);
  }

  out('✅ COT creado:', {
    id: comp.id,
    serie: comp.serie,
    correlativo: comp.correlativo,
    mtoImpVenta: comp.mtoImpVenta,
  });

  const full = await prisma.comprobante.findUnique({
    where: { id: comp.id },
    include: { detalles: true, cliente: { select: { nombre: true } } },
  });
  out('cliente:', full?.cliente?.nombre);
  out(
    'detalles:',
    full?.detalles.map((d: any) => ({
      prod: d.productoId,
      cant: Number(d.cantidad),
      precioUnit: Number(d.mtoValorUnitario),
      total: Number(d.mtoValorVenta),
    })),
  );

  const stockDespues = await prisma.producto.findUnique({
    where: { id: 8415 },
    select: { stock: true },
  });
  out(
    `stock 8415: antes=${stockAntes?.stock} después=${stockDespues?.stock} (COT NO debe moverlo)`,
  );

  // Limpieza: borrar el COT de prueba para no ensuciar la BD local.
  try {
    await comprobante.eliminarCotizacion(comp.id, EMPRESA);
    out('🧹 COT de prueba eliminado.');
  } catch (e: any) {
    out('(no se pudo borrar el COT de prueba:', e?.message, ')');
  }

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  out('ERROR:', e?.message || e);
  process.exit(1);
});
