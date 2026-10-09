/**
 * QA funcional: "Desactivar" tiene que sacar el producto del punto de venta,
 * pero NO del Kardex.
 *
 * Se llama al `listar` real del servicio, con las mismas banderas que manda
 * cada pantalla:
 *   POS    → soloVendibles: true  + sedeId
 *   Kardex → sin soloVendibles
 *
 * Contra una base DESECHABLE, nunca producción:
 *   createdb qa_vendible && psql -d qa_vendible -c 'CREATE EXTENSION vector'
 *   DATABASE_URL=...qa_vendible npx prisma db push --skip-generate --accept-data-loss
 *   DATABASE_URL=...qa_vendible npx ts-node --transpile-only -P tsconfig.json scripts/qa-vendibilidad.ts
 */
import { PrismaClient } from '@prisma/client';
import { ProductoService } from '../src/producto/producto.service';

const prisma = new PrismaClient();
// `listar` solo toca prisma; el resto de dependencias no se usan en este camino.
const service = new ProductoService(prisma as any, null as any, null as any, null as any);

let ok = 0, fallo = 0;
const check = (nombre: string, cond: boolean, detalle = '') => {
  if (cond) { ok++; console.log('  ✓', nombre); }
  else { fallo++; console.log('  ✗', nombre, detalle); }
};

(async () => {
  const plan = await prisma.plan.create({ data: { nombre: 'QA' } });
  const empresa = await prisma.empresa.create({
    data: {
      ruc: '20999999999', razonSocial: 'FRUTA QA S.A.C.', direccion: 'AV. QA 1',
      planId: plan.id, fechaActivacion: new Date(),
      fechaExpiracion: new Date(Date.now() + 9e10),
    },
  });
  const sede = await prisma.sede.create({
    data: { empresaId: empresa.id, nombre: 'Sede Principal', esPrincipal: true },
  });
  const um = await prisma.unidadMedida.create({ data: { codigo: 'NIU', nombre: 'Unidad' } });

  const crear = async (
    codigo: string, descripcion: string,
    estado: any, vendible = true, visible = true,
  ) => {
    const p = await prisma.producto.create({
      data: {
        codigo, descripcion, empresaId: empresa.id, unidadMedidaId: um.id,
        tipoAfectacionIGV: '10', estado, precioUnitario: 10, valorUnitario: 8.47,
      },
    });
    await prisma.productoStock.create({
      data: {
        productoId: p.id, sedeId: sede.id, stock: 10,
        visibleEnSede: visible, vendibleEnSede: vendible,
      },
    });
    return p;
  };

  await crear('A-1', 'MANZANA (activa)', 'ACTIVO');
  await crear('A-2', 'PERA DESACTIVADA', 'INACTIVO');
  await crear('A-3', 'UVA SIN PERMISO DE VENTA', 'ACTIVO', false);
  await crear('A-4', 'KIWI FUERA DE LA SEDE', 'ACTIVO', true, false);

  const nombres = (r: any) =>
    (r?.productos ?? r?.data ?? r ?? []).map((p: any) => p.descripcion).sort();

  console.log('\n1) Lo que ve el PUNTO DE VENTA (soloVendibles + sedeId)');
  const pos = nombres(await service.listar({
    empresaId: empresa.id, sedeId: sede.id, soloVendibles: true, limit: 50,
  } as any));
  console.log('   →', pos.length ? pos.join(' | ') : '(ninguno)');
  check('ofrece la manzana activa', pos.includes('MANZANA (activa)'));
  check('NO ofrece la pera desactivada', !pos.includes('PERA DESACTIVADA'),
        '← ESTE ERA EL BUG');
  check('NO ofrece la uva sin permiso de venta', !pos.includes('UVA SIN PERMISO DE VENTA'));
  check('NO ofrece el kiwi fuera de la sede', !pos.includes('KIWI FUERA DE LA SEDE'));

  console.log('\n2) Lo que ve el KARDEX (sin soloVendibles)');
  const kardex = nombres(await service.listar({ empresaId: empresa.id, limit: 50 } as any));
  console.log('   →', kardex.length ? kardex.join(' | ') : '(ninguno)');
  check('SÍ muestra la pera desactivada, para poder reactivarla',
        kardex.includes('PERA DESACTIVADA'), '← si falla, el producto queda inalcanzable');
  check('muestra también las demás', kardex.length === 4, `→ muestra ${kardex.length} de 4`);

  console.log('\n3) Reactivar la devuelve a la venta');
  await prisma.producto.updateMany({
    where: { empresaId: empresa.id, codigo: 'A-2' }, data: { estado: 'ACTIVO' },
  });
  const pos2 = nombres(await service.listar({
    empresaId: empresa.id, sedeId: sede.id, soloVendibles: true, limit: 50,
  } as any));
  check('la pera reactivada vuelve a aparecer en el POS', pos2.includes('PERA DESACTIVADA'));

  console.log(`\n═══ ${ok} pasaron, ${fallo} fallaron ═══`);
  await prisma.$disconnect();
  process.exit(fallo ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
