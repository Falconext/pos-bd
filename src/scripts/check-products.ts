import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const countAll = await prisma.producto.count();
  console.log('TOTAL PRODUCTS:', countAll);

  // Expected: countAll - 1 = 4000

  // Attempt 1: Using string_contains on a stringified JSON? No, Prisma doesn't support string_contains on Json field.
  // Wait, Prisma supports `path` and `equals`.

  // Attempt 2: What if we use Prisma.AnyNull for the path?
  try {
    const q2 = await prisma.producto.findMany({
      where: {
        OR: [
          { atributosTecnicos: { equals: Prisma.AnyNull } },
          {
            atributosTecnicos: {
              path: ['tipoProducto'],
              equals: Prisma.AnyNull,
            },
          },
          { atributosTecnicos: { path: ['tipoProducto'], not: 'SERVICIO' } },
        ],
      },
      select: { id: true },
    });
    console.log('ATTEMPT 2 MATCHED:', q2.length);
  } catch (e: any) {
    console.log('ATTEMPT 2 FAILED:', e.message);
  }

  // Attempt 3: What if we use a Raw Query condition, or we just check if it equals 'PRODUCTO'?
  // Wait, we can't easily do raw query in Prisma `where` clause without raw() query.

  // Attempt 4: Is there a way to check if a JSON object does NOT contain a key?
  // Prisma doesn't have a direct "has key" operator for Json fields.

  // Let's print the 12 products with non-null attributes to see what they look like
  const allWithAttrs = await prisma.producto.findMany({
    where: {
      NOT: { atributosTecnicos: { equals: Prisma.DbNull } },
    },
    select: { id: true, atributosTecnicos: true },
  });
  console.log(
    'NON-NULL ATTRS:',
    allWithAttrs.map((p) => p.atributosTecnicos),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
