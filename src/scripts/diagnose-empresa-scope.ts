import { PrismaClient } from '@prisma/client';

/**
 * Diagnóstico de scope brand/producto en empresas.
 *
 * El listado del admin (ADMIN_SISTEMA) filtra empresas por `brand` y `producto`,
 * forzando los valores del `sistemaNegocio` / `sistemaProducto` del usuario. Si
 * esos valores no coinciden con el brand/producto real de las empresas, el
 * listado sale vacío ("No se encontraron empresas").
 *
 * Las columnas brand/producto son NOT NULL DEFAULT, así que NO hay NULLs: la
 * causa de una lista vacía es siempre un DESAJUSTE de scope. Este script lo
 * revela:
 *   1. Distribución real de empresas por (brand, producto).
 *   2. Admins de sistema y su scope.
 *   3. Por cada admin: cuántas empresas VE vs OCULTA con su scope actual.
 *
 * Uso:  npm run diagnose:empresa-scope
 * Solo lee — no modifica datos.
 */

const prisma = new PrismaClient();

const BRAND_DEFAULT = 'falconext';
const PRODUCTO_DEFAULT = 'facturacion';

const norm = (v?: string | null) => String(v ?? '').trim().toLowerCase();

async function main() {
  console.log('🔎 Diagnóstico de scope brand/producto en empresas\n');

  // ── 1. Distribución de empresas por brand/producto ──
  const empresas = await prisma.empresa.findMany({
    select: { id: true, brand: true, producto: true, estado: true },
  });
  console.log(`Total empresas: ${empresas.length}`);

  const dist = new Map<string, number>();
  for (const e of empresas) {
    const key = `${e.brand ?? 'NULL'} / ${e.producto ?? 'NULL'}`;
    dist.set(key, (dist.get(key) ?? 0) + 1);
  }
  console.log('\n📊 Distribución por (brand / producto):');
  for (const [key, count] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${key.padEnd(28)} → ${count}`);
  }

  // ── 2. Admins de sistema y su scope ──
  const admins = await prisma.usuario.findMany({
    where: { rol: 'ADMIN_SISTEMA' as any },
    select: { id: true, email: true, sistemaNegocio: true, sistemaProducto: true },
  });

  console.log(`\n👤 Admins de sistema: ${admins.length}`);
  for (const a of admins) {
    // Brand/producto efectivo del filtro (mismo criterio que empresa.service.ts)
    const brandFiltro = a.sistemaNegocio ? (norm(a.sistemaNegocio) === 'krezka' ? 'krezka' : 'falconext') : null;
    const prodFiltro = a.sistemaProducto ? (norm(a.sistemaProducto) === 'hotel' ? 'hotel' : 'facturacion') : null;

    const visibles = empresas.filter((e) => {
      const eb = norm(e.brand) || BRAND_DEFAULT;
      const ep = norm(e.producto) || PRODUCTO_DEFAULT;
      const okBrand = !brandFiltro || eb === brandFiltro;
      const okProd = !prodFiltro || ep === prodFiltro;
      return okBrand && okProd;
    }).length;

    const ocultas = empresas.length - visibles;
    const flag = ocultas > 0 ? `  ⚠️  OCULTA ${ocultas} empresa(s)` : '';
    console.log(
      `   #${a.id} ${a.email}\n` +
      `      scope → negocio=${a.sistemaNegocio ?? '∅'} | producto=${a.sistemaProducto ?? '∅'}` +
      `  (filtro: brand=${brandFiltro ?? 'todos'}, producto=${prodFiltro ?? 'todos'})\n` +
      `      ve ${visibles}/${empresas.length} empresas${flag}`,
    );
  }

  console.log('\n🎯 Si un admin "OCULTA empresas", ahí está el problema: su sistemaNegocio/sistemaProducto');
  console.log('   no coincide con el brand/producto de las empresas que quiere ver.');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
