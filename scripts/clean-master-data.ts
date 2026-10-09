import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanMasterData() {
  try {
    console.log('🧹 Iniciando limpieza de datos maestros...');

    // Eliminar datos usando TRUNCATE CASCADE para manejar dependencias
    console.log('Eliminando MotivoNota...');
    await prisma.$executeRaw`TRUNCATE TABLE "MotivoNota" CASCADE`;

    console.log('Eliminando Plan...');
    await prisma.$executeRaw`TRUNCATE TABLE "Plan" CASCADE`;

    console.log('Eliminando UnidadMedida...');
    await prisma.$executeRaw`TRUNCATE TABLE "UnidadMedida" CASCADE`;

    console.log('Eliminando TipoDocumento...');
    await prisma.$executeRaw`TRUNCATE TABLE "TipoDocumento" CASCADE`;

    console.log('Eliminando Ubigeo...');
    await prisma.$executeRaw`TRUNCATE TABLE "Ubigeo" CASCADE`;

    console.log('Eliminando TipoOperacion...');
    await prisma.$executeRaw`TRUNCATE TABLE "TipoOperacion" CASCADE`;

    console.log('✅ Limpieza de datos maestros completada exitosamente');
    
    // Verificar que las tablas estén vacías
    const counts = {
      tipoOperacion: await prisma.tipoOperacion.count(),
      ubigeo: await prisma.ubigeo.count(),
      tipoDocumento: await prisma.tipoDocumento.count(),
      unidadMedida: await prisma.unidadMedida.count(),
      plan: await prisma.plan.count(),
      motivoNota: await prisma.motivoNota.count(),
    };

    console.log('\n📊 Conteo de registros después de la limpieza:');
    Object.entries(counts).forEach(([tabla, count]) => {
      console.log(`  ${tabla}: ${count} registros`);
    });

  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanMasterData();