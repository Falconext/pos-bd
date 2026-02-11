import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando migración de stock a Sedes...');

  // 1. Obtener todas las empresas
  const empresas = await prisma.empresa.findMany();
  console.log(`Se encontraron ${empresas.length} empresas.`);

  for (const empresa of empresas) {
    console.log(`Procesando empresa: ${empresa.razonSocial} (${empresa.id})`);

    // 2. Verificar o crear Sede Principal
    let sede = await prisma.sede.findFirst({
      where: { empresaId: empresa.id, esPrincipal: true },
    });

    if (!sede) {
      console.log(`  - Creando Sede Principal...`);
      sede = await prisma.sede.create({
        data: {
          empresaId: empresa.id,
          nombre: 'Sede Principal',
          direccion: empresa.direccion,
          esPrincipal: true,
        },
      });
    } else {
      console.log(`  - Sede Principal ya existe (ID: ${sede.id}).`);
    }

    // 3. Migrar stock de productos
    const productos = await prisma.producto.findMany({
      where: { empresaId: empresa.id },
    });

    console.log(`  - Migrando stock de ${productos.length} productos...`);

    for (const producto of productos) {
      // Verificar si ya existe stock en esa sede
      const stockExistente = await prisma.productoStock.findUnique({
        where: {
          productoId_sedeId: {
            productoId: producto.id,
            sedeId: sede.id,
          },
        },
      });

      if (!stockExistente) {
        await prisma.productoStock.create({
          data: {
            productoId: producto.id,
            sedeId: sede.id,
            stock: producto.stock, // Copiar stock actual
            stockMinimo: producto.stockMinimo || 0,
            stockMaximo: producto.stockMaximo,
          },
        });
      }
    }
  }

  console.log('Migración completada exitosamente.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
