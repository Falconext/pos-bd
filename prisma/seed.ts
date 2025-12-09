import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed...');

  // =============================================
  // PLANES FORMALES (Empresas con RUC)
  // =============================================
  const planesFormalMensual = [
    {
      nombre: 'MICRO_MENSUAL',
      descripcion: 'Plan Micro - 100 comprobantes/mes',
      costo: 35.00,
      esPrueba: false,
      limiteUsuarios: 1,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
    {
      nombre: 'EMPRENDE_MENSUAL',
      descripcion: 'Plan Emprende - 300 comprobantes/mes',
      costo: 42.00,
      esPrueba: false,
      limiteUsuarios: 2,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
    {
      nombre: 'CONTROL_MENSUAL',
      descripcion: 'Plan Control - 500 comprobantes/mes (Popular)',
      costo: 49.90,
      esPrueba: false,
      limiteUsuarios: 3,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
    {
      nombre: 'BACAN_MENSUAL',
      descripcion: 'Plan Bacán - 600 comprobantes/mes',
      costo: 59.90,
      esPrueba: false,
      limiteUsuarios: 5,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
    {
      nombre: 'SUPER_MENSUAL',
      descripcion: 'Plan Súper - 800 comprobantes/mes',
      costo: 79.90,
      esPrueba: false,
      limiteUsuarios: 7,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
    {
      nombre: 'MEGA_MENSUAL',
      descripcion: 'Plan Mega - 1200 comprobantes/mes',
      costo: 99.90,
      esPrueba: false,
      limiteUsuarios: 10,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
  ];

  const planesFormalAnual = [
    {
      nombre: 'MICRO_ANUAL',
      descripcion: 'Plan Micro Anual - 100 comprobantes/mes',
      costo: 350.00,
      esPrueba: false,
      limiteUsuarios: 1,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
    {
      nombre: 'EMPRENDE_ANUAL',
      descripcion: 'Plan Emprende Anual - 300 comprobantes/mes',
      costo: 420.00,
      esPrueba: false,
      limiteUsuarios: 2,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
    {
      nombre: 'CONTROL_ANUAL',
      descripcion: 'Plan Control Anual - 500 comprobantes/mes (Popular)',
      costo: 500.00,
      esPrueba: false,
      limiteUsuarios: 3,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
    {
      nombre: 'BACAN_ANUAL',
      descripcion: 'Plan Bacán Anual - 600 comprobantes/mes',
      costo: 600.00,
      esPrueba: false,
      limiteUsuarios: 5,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
    {
      nombre: 'SUPER_ANUAL',
      descripcion: 'Plan Súper Anual - 800 comprobantes/mes',
      costo: 800.00,
      esPrueba: false,
      limiteUsuarios: 7,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
    {
      nombre: 'MEGA_ANUAL',
      descripcion: 'Plan Mega Anual - 1200 comprobantes/mes',
      costo: 1000.00,
      esPrueba: false,
      limiteUsuarios: 10,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
  ];

  // =============================================
  // PLANES INFORMALES (Emprendedores sin RUC)
  // =============================================
  const planesInformalMensual = [
    {
      nombre: 'EMPRENDE_INFORMAL_FREE',
      descripcion: 'Plan Emprende Informal Gratis - 200 ventas/mes',
      costo: 0,
      esPrueba: false,
      limiteUsuarios: 1,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
    {
      nombre: 'CRECIMIENTO_INFORMAL_MENSUAL',
      descripcion: 'Plan Crecimiento Informal - Ventas ilimitadas',
      costo: 9.90,
      esPrueba: false,
      limiteUsuarios: 2,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
    {
      nombre: 'PRO_INFORMAL_MENSUAL',
      descripcion: 'Plan Pro Informal - Inventario avanzado',
      costo: 19.90,
      esPrueba: false,
      limiteUsuarios: 5,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: false,
    },
  ];

  const planesInformalAnual = [
    {
      nombre: 'CRECIMIENTO_INFORMAL_ANUAL',
      descripcion: 'Plan Crecimiento Informal Anual - Ventas ilimitadas',
      costo: 99.00,
      esPrueba: false,
      limiteUsuarios: 2,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
    {
      nombre: 'PRO_INFORMAL_ANUAL',
      descripcion: 'Plan Pro Informal Anual - Inventario avanzado',
      costo: 199.00,
      esPrueba: false,
      limiteUsuarios: 5,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: false,
    },
  ];

  // =============================================
  // ADDON: TIENDA VIRTUAL (se suma al plan base)
  // =============================================
  const addonTiendaVirtual = [
    {
      nombre: 'TIENDA_VIRTUAL_MENSUAL',
      descripcion: 'Addon Tienda Virtual - Mensual',
      costo: 29.90,
      esPrueba: false,
      limiteUsuarios: 0,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      tieneTienda: true,
    },
    {
      nombre: 'TIENDA_VIRTUAL_ANUAL',
      descripcion: 'Addon Tienda Virtual - Anual',
      costo: 299.00,
      esPrueba: false,
      limiteUsuarios: 0,
      duracionDias: 365,
      tipoFacturacion: 'ANUAL',
      tieneTienda: true,
    },
  ];

  // =============================================
  // PLAN DE PRUEBA
  // =============================================
  const planPrueba = [
    {
      nombre: 'PRUEBA',
      descripcion: 'Plan de prueba - 15 días sin costo',
      costo: 0,
      esPrueba: true,
      limiteUsuarios: 5,
      duracionDias: 15,
      tipoFacturacion: 'PRUEBA',
      tieneTienda: true,
    },
  ];

  // Combinar todos los planes
  const planes = [
    ...planPrueba,
    ...planesFormalMensual,
    ...planesFormalAnual,
    ...planesInformalMensual,
    ...planesInformalAnual,
    ...addonTiendaVirtual,
  ];

  for (const plan of planes) {
    const existente = await prisma.plan.findUnique({
      where: { nombre: plan.nombre },
    });
    if (!existente) {
      const created = await prisma.plan.create({
        data: plan,
      });
      console.log(`✓ Plan creado: ${created.nombre} - S/ ${created.costo}`);
    } else {
      console.log(`✓ Plan ya existe: ${plan.nombre}`);
    }
  }

  // Crear usuario admin
  const saltRounds = 10;
  const plainPassword = 'Admin123!';
  const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);

  const usuarioExistente = await prisma.usuario.findUnique({
    where: { email: 'admin@nephi.test' },
  });

  if (!usuarioExistente) {
    const usuario = await prisma.usuario.create({
      data: {
        nombre: 'Administrador Sistema',
        dni: '00000000',
        celular: '999999999',
        email: 'admin@nephi.test',
        password: hashedPassword,
        rol: 'ADMIN_SISTEMA',
        estado: 'ACTIVO',
      },
    });
    console.log(`✓ Admin creado: ${usuario.email}`);
    console.log(`  Contraseña: ${plainPassword}`);
  } else {
    console.log(`✓ Admin ya existe: ${usuarioExistente.email}`);
  }

  console.log('\n✓ Seed completado exitosamente');
}

main()
  .catch((e) => {
    console.error('Error al ejecutar la semilla:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });