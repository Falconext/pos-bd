import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Actualizando publicarEnTienda para todos los productos...');
  const result = await prisma.producto.updateMany({
    data: {
      publicarEnTienda: true,
    },
  });
  console.log(`Productos actualizados: ${result.count}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
