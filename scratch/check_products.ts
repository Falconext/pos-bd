import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ids = [3910, 3911, 3913, 3914, 3908];
  const productos = await prisma.producto.findMany({
    where: { id: { in: ids } },
    select: { id: true, descripcion: true, estado: true, empresaId: true }
  });

  console.log('--- DIAGNÓSTICO DE PRODUCTOS ---');
  productos.forEach(p => {
    console.log(`ID: ${p.id}, Desc: ${p.descripcion}, Estado: ${p.estado}, EmpresaId: ${p.empresaId}`);
  });
  console.log('-------------------------------');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
