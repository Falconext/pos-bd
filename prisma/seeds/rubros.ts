import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedRubros() {
  console.log('🌱 Seeding rubros...');
  
  const rubros = [
    'Restaurantes y comida',
    'Retail y comercio',
    'Servicios profesionales',
    'Tecnología y software',
    'Salud y bienestar', 
    'Educación y capacitación',
    'Construcción y obras',
    'Transporte y logística',
    'Belleza y cuidado personal',
    'Entretenimiento y eventos',
    'Agricultura y ganadería',
    'Textil y confecciones',
    'Automotriz y repuestos',
    'Inmobiliaria',
    'Turismo y viajes',
    'Servicios financieros',
    'Fabricación y producción',
    'Arte y diseño',
    'Deportes y recreación',
    'Otros servicios'
  ];

  for (const nombreRubro of rubros) {
    try {
      const rubro = await prisma.rubro.upsert({
        where: { nombre: nombreRubro },
        update: {},
        create: { nombre: nombreRubro }
      });
      
      console.log(`✅ Rubro: ${rubro.nombre}`);
    } catch (error) {
      console.error(`❌ Error creating rubro ${nombreRubro}:`, error);
    }
  }
}

async function main() {
  try {
    await seedRubros();
    
    // Verificar rubros creados
    const rubrosCount = await prisma.rubro.count();
    console.log(`\n📊 Total rubros en BD: ${rubrosCount}`);
    
  } catch (error) {
    console.error('❌ Error in seeding process:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { seedRubros };
