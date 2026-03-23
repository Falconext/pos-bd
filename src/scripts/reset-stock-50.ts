import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STOCK_OBJETIVO = 50;

async function main() {
  console.log(`🚀 Iniciando actualización de stock a ${STOCK_OBJETIVO} unidades...`);

  // 1. Actualizar campo legacy Producto.stock
  const resultProducto = await prisma.producto.updateMany({
    where: {
      estado: { not: 'INACTIVO' as any },
    },
    data: {
      stock: STOCK_OBJETIVO,
    },
  });
  console.log(`✅ Producto.stock actualizado en ${resultProducto.count} productos.`);

  // 2. Actualizar registros existentes en ProductoStock
  const resultProductoStock = await prisma.productoStock.updateMany({
    data: {
      stock: STOCK_OBJETIVO,
    },
  });
  console.log(`✅ ProductoStock actualizado en ${resultProductoStock.count} registros de sede.`);

  // 3. Crear registros faltantes en ProductoStock (productos sin entrada en la tabla)
  console.log('🔍 Verificando productos sin registro en ProductoStock...');

  const empresas = await prisma.empresa.findMany({
    include: { sedes: { where: { esPrincipal: true } } },
  });

  let creados = 0;

  for (const empresa of empresas) {
    const sedePrincipal = empresa.sedes[0];
    if (!sedePrincipal) {
      console.log(`⚠️  Empresa ${empresa.razonSocial} (${empresa.id}) no tiene sede principal. Saltando...`);
      continue;
    }

    const productos = await prisma.producto.findMany({
      where: {
        empresaId: empresa.id,
        estado: { not: 'INACTIVO' as any },
        stocks: { none: { sedeId: sedePrincipal.id } },
      },
      select: { id: true, stockMinimo: true, stockMaximo: true },
    });

    for (const producto of productos) {
      await prisma.productoStock.create({
        data: {
          productoId: producto.id,
          sedeId: sedePrincipal.id,
          stock: STOCK_OBJETIVO,
          stockMinimo: producto.stockMinimo ?? 0,
          stockMaximo: producto.stockMaximo ?? null,
        },
      });
      creados++;
    }

    if (productos.length > 0) {
      console.log(
        `   ✨ ${productos.length} registros nuevos en ProductoStock para Empresa "${empresa.razonSocial}" (sede ${sedePrincipal.nombre}).`,
      );
    }
  }

  console.log(`\n📊 Resumen:`);
  console.log(`   - Producto.stock actualizado: ${resultProducto.count} productos`);
  console.log(`   - ProductoStock actualizado:  ${resultProductoStock.count} registros`);
  console.log(`   - ProductoStock creados:      ${creados} registros nuevos`);
  console.log(`\n🎉 Todos los productos ahora tienen ${STOCK_OBJETIVO} unidades de stock.`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante la actualización:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
