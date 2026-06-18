const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const productsWithAttrs = await prisma.producto.findMany({
    where: {
      NOT: { atributosTecnicos: { equals: Prisma.DbNull } }
    },
    select: { id: true, atributosTecnicos: true }
  });

  console.log('Total products with non-null attrs:', productsWithAttrs.length);
  
  // Test Prisma.AnyNull for path
  try {
    const q = await prisma.producto.findMany({
      where: {
        atributosTecnicos: {
          path: ['tipoProducto'],
          equals: Prisma.AnyNull
        }
      }
    });
    console.log('AnyNull for path matched:', q.length);
  } catch(e) {
    console.log('AnyNull error:', e.message);
  }

  // Test not 'SERVICIO' combined with AnyNull
  try {
    const q2 = await prisma.producto.findMany({
      where: {
        OR: [
          { atributosTecnicos: { equals: Prisma.DbNull } },
          { atributosTecnicos: { path: ['tipoProducto'], equals: Prisma.AnyNull } },
          { atributosTecnicos: { path: ['tipoProducto'], not: 'SERVICIO' } }
        ]
      }
    });
    console.log('Combined OR matched:', q2.length);
  } catch(e) {
    console.log('Combined error:', e.message);
  }
}

main().then(() => process.exit(0)).catch(e => console.error(e));
