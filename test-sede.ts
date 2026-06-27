import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const sede = await prisma.sede.findFirst({
    where: {
      id: Number(process.argv[2]),
      empresaId: Number(process.argv[3]),
      activo: true,
    }
  });
  console.log(sede);
}
run();
