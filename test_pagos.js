const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pagos = await prisma.pago.findMany({
    take: 5,
    orderBy: { id: 'desc' },
    include: { usuario: true }
  });
  console.log(JSON.stringify(pagos, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
