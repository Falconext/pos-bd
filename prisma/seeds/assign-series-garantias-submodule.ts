import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const kardexModulo = await prisma.modulo.findFirst({
    where: { codigo: 'kardex', producto: 'facturacion' },
  });

  if (!kardexModulo) {
    throw new Error('No existe el módulo Kardex');
  }

  const subModulo = await prisma.subModulo.upsert({
    where: { codigo: 'kardex:series-garantias' },
    update: {
      moduloId: kardexModulo.id,
      nombre: 'Series y Garantías',
      descripcion: 'Trazabilidad por número de serie y garantías',
      ruta: '/administrador/kardex/series-garantias',
      orden: 7,
      activo: true,
    },
    create: {
      moduloId: kardexModulo.id,
      codigo: 'kardex:series-garantias',
      nombre: 'Series y Garantías',
      descripcion: 'Trazabilidad por número de serie y garantías',
      ruta: '/administrador/kardex/series-garantias',
      orden: 7,
      activo: true,
    },
  });

  const planesConKardex = await prisma.plan.findMany({
    where: {
      producto: 'facturacion',
      modulosAsignados: {
        some: { moduloId: kardexModulo.id },
      },
    },
    select: { id: true, nombre: true },
  });

  for (const plan of planesConKardex) {
    await prisma.planSubModulo.upsert({
      where: {
        planId_subModuloId: {
          planId: plan.id,
          subModuloId: subModulo.id,
        },
      },
      update: {},
      create: {
        planId: plan.id,
        subModuloId: subModulo.id,
      },
    });
    console.log(`Asignado a plan: ${plan.nombre}`);
  }

  console.log(`Listo: ${planesConKardex.length} planes actualizados.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
