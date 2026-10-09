import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMinimalMasterData() {
  try {
    console.log('📦 Creando datos maestros mínimos...');

    // Tipos de documento básicos
    const tiposDocumento = [
      { codigo: '1', descripcion: 'DNI' },
      { codigo: '4', descripcion: 'CE' },
      { codigo: '6', descripcion: 'RUC' },
      { codigo: '7', descripcion: 'Pasaporte' },
      { codigo: '0', descripcion: 'Otros' }
    ];

    for (const tipoDoc of tiposDocumento) {
      const exists = await prisma.tipoDocumento.findUnique({
        where: { codigo: tipoDoc.codigo }
      });
      if (!exists) {
        await prisma.tipoDocumento.create({ data: tipoDoc });
        console.log(`✅ Tipo documento creado: ${tipoDoc.descripcion}`);
      }
    }

    // Unidades de medida básicas
    const unidadesMedida = [
      { codigo: 'NIU', nombre: 'UNIDAD' },
      { codigo: 'KGM', nombre: 'KILOGRAMO' },
      { codigo: 'LTR', nombre: 'LITRO' },
      { codigo: 'MTR', nombre: 'METRO' },
      { codigo: 'GLL', nombre: 'GALONES' },
      { codigo: 'ZZ', nombre: 'OTROS' }
    ];

    for (const unidad of unidadesMedida) {
      const exists = await prisma.unidadMedida.findUnique({
        where: { codigo: unidad.codigo }
      });
      if (!exists) {
        await prisma.unidadMedida.create({ data: unidad });
        console.log(`✅ Unidad medida creada: ${unidad.nombre}`);
      }
    }

    // Rubro básico
    const rubroBasico = await prisma.rubro.findUnique({
      where: { id: 1 }
    });
    if (!rubroBasico) {
      await prisma.rubro.create({
        data: {
          id: 1,
          nombre: 'Comercio General'
        }
      });
      console.log('✅ Rubro básico creado');
    }

    // Verificar que el plan con ID 4 existe
    const plan4 = await prisma.plan.findUnique({
      where: { id: 4 }
    });
    if (!plan4) {
      console.log('❌ Plan con ID 4 no existe. Planes disponibles:');
      const planes = await prisma.plan.findMany();
      planes.forEach(plan => {
        console.log(`  - ID: ${plan.id}, Nombre: ${plan.nombre}`);
      });
    } else {
      console.log(`✅ Plan con ID 4 encontrado: ${plan4.nombre}`);
    }

    console.log('✅ Datos maestros mínimos creados exitosamente');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createMinimalMasterData();