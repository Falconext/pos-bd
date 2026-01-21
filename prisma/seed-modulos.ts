import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const modulosIniciales = [
  { 
    codigo: 'dashboard', 
    nombre: 'Dashboard', 
    descripcion: 'Acceso al panel principal con métricas y estadísticas', 
    icono: 'mdi:view-dashboard', 
    orden: 1 
  },
  { 
    codigo: 'comprobantes', 
    nombre: 'Comprobantes', 
    descripcion: 'Gestión de facturas, boletas, notas de crédito y débito', 
    icono: 'mdi:file-document', 
    orden: 2 
  },
  { 
    codigo: 'clientes', 
    nombre: 'Clientes', 
    descripcion: 'Gestión de clientes y proveedores', 
    icono: 'mdi:account-group', 
    orden: 3 
  },
  { 
    codigo: 'kardex', 
    nombre: 'Kardex', 
    descripcion: 'Gestión de inventario, productos y movimientos de stock', 
    icono: 'mdi:package-variant', 
    orden: 4 
  },
  { 
    codigo: 'reportes', 
    nombre: 'Reportes', 
    descripcion: 'Reportes de ventas, compras y contabilidad', 
    icono: 'mdi:chart-bar', 
    orden: 5 
  },
  { 
    codigo: 'configuracion', 
    nombre: 'Configuración', 
    descripcion: 'Configuración general del sistema y la empresa', 
    icono: 'mdi:cog', 
    orden: 6 
  },
  { 
    codigo: 'usuarios', 
    nombre: 'Usuarios', 
    descripcion: 'Gestión de usuarios y permisos del sistema', 
    icono: 'mdi:account-multiple', 
    orden: 7 
  },
  { 
    codigo: 'caja', 
    nombre: 'Caja', 
    descripcion: 'Apertura, cierre y movimientos de caja', 
    icono: 'mdi:cash-register', 
    orden: 8 
  },
  { 
    codigo: 'pagos', 
    nombre: 'Gestión de Pagos', 
    descripcion: 'Cobros, pagos y conciliaciones bancarias', 
    icono: 'mdi:credit-card', 
    orden: 9 
  },
];

async function seedModulos() {
  console.log('🌱 Seeding módulos del sistema...');
  
  for (const modulo of modulosIniciales) {
    await prisma.modulo.upsert({
      where: { codigo: modulo.codigo },
      update: modulo,
      create: modulo,
    });
    console.log(`✅ Módulo ${modulo.nombre} creado/actualizado`);
  }
  
  console.log('\n🔗 Asignando todos los módulos a planes existentes...');
  
  // Obtener todos los planes
  const planes = await prisma.plan.findMany();
  const modulos = await prisma.modulo.findMany();
  
  // Asignar todos los módulos a cada plan existente (migración)
  for (const plan of planes) {
    for (const modulo of modulos) {
      const exists = await prisma.planModulo.findUnique({
        where: {
          planId_moduloId: {
            planId: plan.id,
            moduloId: modulo.id
          }
        }
      });
      
      if (!exists) {
        await prisma.planModulo.create({
          data: {
            planId: plan.id,
            moduloId: modulo.id
          }
        });
        console.log(`✅ Asignado ${modulo.nombre} al plan ${plan.nombre}`);
      }
    }
  }
  
  console.log('\n✨ Seed completado exitosamente!');
}

seedModulos()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Error durante el seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
