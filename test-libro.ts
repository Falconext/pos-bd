import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const empresaId = 1; // Probablemente sea 1
  const productosControlados = await prisma.producto.findMany({
    where: { controlado: true },
    select: { id: true, descripcion: true, controlado: true }
  });
  console.log("Productos controlados:", productosControlados);

  const salidas = await prisma.detalleComprobante.findMany({
    where: {
      producto: { controlado: true }
    },
    include: {
      comprobante: { select: { fechaEmision: true, serie: true, correlativo: true } }
    }
  });
  console.log("Salidas de psicotropicos:", salidas.length, salidas.map(s => s.comprobante?.serie));
}
main().finally(() => prisma.$disconnect());
