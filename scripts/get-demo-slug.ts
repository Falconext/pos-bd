
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Check for existing store
  const existing = await prisma.empresa.findFirst({
    where: {
      slugTienda: { not: null },
      estado: 'ACTIVO'
    },
    include: {
        plan: true
    }
  });

  if (existing) {
    console.log(`FOUND_STORE_SLUG: ${existing.slugTienda}`);
    return;
  }

  // 2. If not found, create one
  console.log('No store found. Creating demo store...');
  
  // Ensure plan exists
  let plan = await prisma.plan.findFirst({
      where: { tieneTienda: true }
  });
  
  if (!plan) {
      plan = await prisma.plan.create({
          data: {
              nombre: 'DEMO_TIENDA_PLAN',
              descripcion: 'Plan Demo',
              costo: 0,
              tieneTienda: true,
              esPrueba: true
          }
      });
  }

  // Create demo company
  const demoStore = await prisma.empresa.create({
    data: {
      razonSocial: 'La Salchipapa de Don Pepe',
      ruc: '20123456781',
      direccion: 'Av. Las Papas 123',
      fechaActivacion: new Date(),
      fechaExpiracion: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      planId: plan.id,
      estado: 'ACTIVO',
      slugTienda: 'don-pepe',
      descripcionTienda: 'Las mejores salchipapas del barrio',
      whatsappTienda: '999888777',
      colorPrimario: '#FF9900',
      tipoEmpresa: 'INFORMAL',
      costoEnvioFijo: 5.00
    }
  });

  // Create some products for the store
  const unidad = await prisma.unidadMedida.upsert({
      where: { codigo: 'NIU' },
      update: {},
      create: { codigo: 'NIU', nombre: 'UNIDAD' }
  });

  await prisma.producto.create({
      data: {
          codigo: 'SALCHI01',
          descripcion: 'Salchipapa Clásica',
          unidadMedidaId: unidad.id,
          tipoAfectacionIGV: '10',
          precioUnitario: 12.00,
          valorUnitario: 10.17,
          stock: 100,
          empresaId: demoStore.id,
          publicarEnTienda: true,
          descripcionLarga: 'Papas nativas fritas con hotdog frankfurter y cremas de la casa.',
          imagenUrl: 'https://images.unsplash.com/photo-1585109649139-366815a0d794?q=80&w=2670&auto=format&fit=crop',
          destacado: true
      }
  });
  
    await prisma.producto.create({
      data: {
          codigo: 'SALCHI02',
          descripcion: 'Salchipapa Royal',
          unidadMedidaId: unidad.id,
          tipoAfectacionIGV: '10',
          precioUnitario: 18.00,
          valorUnitario: 15.25,
          stock: 100,
          empresaId: demoStore.id,
          publicarEnTienda: true,
          descripcionLarga: 'Papas, hotdog, huevo frito y queso montado.',
          imagenUrl: 'https://images.unsplash.com/photo-1694863762699-aca426550774?q=80&w=2576&auto=format&fit=crop',
          destacado: true
      }
  });

  console.log(`FOUND_STORE_SLUG: ${demoStore.slugTienda}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
