import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const empresaId = 66;
  const fechaInicio = new Date('2026-01-01T00:00:00-05:00');
  const fechaFin = new Date('2026-06-27T23:59:59-05:00');
  const productoWhere: any = { empresaId, controlado: true };
  const salidas = await prisma.detalleComprobante.findMany({
    where: {
      comprobante: { empresaId, fechaEmision: { gte: fechaInicio, lte: fechaFin } },
      productoId: { not: null },
      producto: productoWhere,
    },
    include: {
      comprobante: { select: { fechaEmision: true, serie: true, correlativo: true } },
      producto: { select: { id: true, descripcion: true } }
    }
  });
  console.log("SALIDAS FOUND:", salidas.length);
}
main();
