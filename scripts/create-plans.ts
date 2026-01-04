import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createPlans() {
  try {
    console.log('📋 Creando planes de suscripción...');

    const planes = [
      // Planes para Empresas nuevos sin ruc 20 - Mensuales
      {
        nombre: 'Mi Básico Informal',
        descripcion: 'Plan básico para emprendedores nuevos sin ruc 20',
        limiteUsuarios: 2,
        costo: 20,
        esPrueba: false,
        duracionDias: 30,
        tipoFacturacion: 'MENSUAL'
      },
      {
        nombre: 'Pro Informal',
        descripcion: 'Plan profesional para negocios nuevos sin ruc 20 en crecimiento',
        limiteUsuarios: 5,
        costo: 30,
        esPrueba: false,
        duracionDias: 30,
        tipoFacturacion: 'MENSUAL'
      },
      // Planes para Empresas Formales - Mensuales
      {
        nombre: 'Básico Formal',
        descripcion: 'Plan básico para empresas formales',
        limiteUsuarios: 3,
        costo: 45,
        esPrueba: false,
        duracionDias: 30,
        tipoFacturacion: 'MENSUAL'
      },
      {
        nombre: 'Pro Formal',
        descripcion: 'Plan profesional para empresas formales establecidas',
        limiteUsuarios: 10,
        costo: 60,
        esPrueba: false,
        duracionDias: 30,
        tipoFacturacion: 'MENSUAL'
      },
      {
        nombre: 'Empresarial',
        descripcion: 'Plan empresarial con usuarios ilimitados',
        limiteUsuarios: null, // null = ilimitado
        costo: 99,
        esPrueba: false,
        duracionDias: 30,
        tipoFacturacion: 'MENSUAL'
      },
      // Planes Anuales (con 15% de descuento aproximadamente)
      {
        nombre: 'Mi Básico Informal - Anual',
        descripcion: 'Plan básico anual para emprendedores nuevos sin ruc 20 (2 meses gratis)',
        limiteUsuarios: 2,
        costo: 204, // 20 * 10.2 (equivale a 10.2 meses)
        esPrueba: false,
        duracionDias: 365,
        tipoFacturacion: 'ANUAL'
      },
      {
        nombre: 'Pro Informal - Anual',
        descripcion: 'Plan profesional anual para negocios nuevos sin ruc 20 (2 meses gratis)',
        limiteUsuarios: 5,
        costo: 306, // 30 * 10.2 
        esPrueba: false,
        duracionDias: 365,
        tipoFacturacion: 'ANUAL'
      },
      {
        nombre: 'Básico Formal - Anual',
        descripcion: 'Plan básico anual para empresas formales (2 meses gratis)',
        limiteUsuarios: 3,
        costo: 459, // 45 * 10.2
        esPrueba: false,
        duracionDias: 365,
        tipoFacturacion: 'ANUAL'
      },
      {
        nombre: 'Pro Formal - Anual',
        descripcion: 'Plan profesional anual para empresas formales (2 meses gratis)',
        limiteUsuarios: 10,
        costo: 612, // 60 * 10.2
        esPrueba: false,
        duracionDias: 365,
        tipoFacturacion: 'ANUAL'
      },
      {
        nombre: 'Empresarial - Anual',
        descripcion: 'Plan empresarial anual con usuarios ilimitados (2 meses gratis)',
        limiteUsuarios: null,
        costo: 1009.8, // 99 * 10.2
        esPrueba: false,
        duracionDias: 365,
        tipoFacturacion: 'ANUAL'
      }
    ];

    let createdCount = 0;

    for (const planData of planes) {
      try {
        const existingPlan = await prisma.plan.findUnique({
          where: { nombre: planData.nombre }
        });

        if (!existingPlan) {
          await prisma.plan.create({ data: planData });
          console.log(`✅ Plan creado: ${planData.nombre} - $${planData.costo} soles (${planData.tipoFacturacion})`);
          createdCount++;
        } else {
          console.log(`⚠️ Plan ya existe: ${planData.nombre}`);
        }
      } catch (error) {
        console.error(`❌ Error creando plan ${planData.nombre}:`, error);
      }
    }

    console.log(`\n🎉 Proceso completado: ${createdCount} planes nuevos sin ruc 20 creados`);

    // Mostrar resumen de todos los planes
    console.log('\n📊 Resumen de planes disponibles:');
    const allPlans = await prisma.plan.findMany({
      orderBy: [
        { tipoFacturacion: 'asc' },
        { costo: 'asc' }
      ]
    });

    console.log('\n--- PLANES MENSUALES ---');
    allPlans
      .filter(plan => plan.tipoFacturacion === 'MENSUAL')
      .forEach(plan => {
        const usuarios = plan.limiteUsuarios ? `${plan.limiteUsuarios} usuarios` : 'Usuarios ilimitados';
        console.log(`• ${plan.nombre}: S/ ${plan.costo}/mes - ${usuarios}`);
      });

    console.log('\n--- PLANES ANUALES (Con descuento) ---');
    allPlans
      .filter(plan => plan.tipoFacturacion === 'ANUAL')
      .forEach(plan => {
        const usuarios = plan.limiteUsuarios ? `${plan.limiteUsuarios} usuarios` : 'Usuarios ilimitados';
        const ahorroMensual = (Number(plan.costo) / 12).toFixed(2);
        console.log(`• ${plan.nombre}: S/ ${plan.costo}/año (~S/ ${ahorroMensual}/mes) - ${usuarios}`);
      });

  } catch (error) {
    console.error('❌ Error general:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createPlans();