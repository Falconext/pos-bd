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
  {
    codigo: 'compras',
    nombre: 'Compras',
    descripcion: 'Gestión de órdenes de compra y proveedores',
    icono: 'mdi:cart-arrow-down',
    orden: 10,
  },
  {
    codigo: 'tienda',
    nombre: 'Tienda Virtual',
    descripcion: 'Configuración y gestión de la tienda en línea',
    icono: 'mdi:store',
    orden: 11,
  },
];

async function seedModulos() {
  console.log('🌱 Seeding módulos del sistema...');
  
  for (const modulo of modulosIniciales) {
    const moduloData = { ...modulo, producto: 'facturacion' as const };
    await prisma.modulo.upsert({
      where: { codigo_producto: { codigo: modulo.codigo, producto: 'facturacion' } },
      update: moduloData,
      create: moduloData,
    });
    console.log(`✅ Módulo ${modulo.nombre} creado/actualizado`);
  }
  
  console.log('\n🔗 Asignando todos los módulos a planes existentes...');
  
  // Obtener todos los planes
  const planes = await prisma.plan.findMany();
  const modulos = await prisma.modulo.findMany();
  
  // Asignar todos los módulos a cada plan existente (migración)
  for (const plan of planes) {
    const productoPlan = (plan as any).producto || 'facturacion';
    const modulosDelProducto = modulos.filter((m: any) => ((m as any).producto || 'facturacion') === productoPlan);
    for (const modulo of modulosDelProducto) {
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
  
  // ── Submódulos por módulo ─────────────────────────────────────────────────
  console.log('\n🔧 Seeding submódulos...');

  const subModulosData: { moduloCodigo: string; codigo: string; nombre: string; descripcion: string; orden: number }[] = [
    // Kardex
    { moduloCodigo: 'kardex', codigo: 'kardex:dashboard',   nombre: 'Dashboard',          descripcion: 'Gráficos y análisis del inventario',            orden: 1 },
    { moduloCodigo: 'kardex', codigo: 'kardex:productos',   nombre: 'Inventario',          descripcion: 'Productos, marcas, categorías y análisis financiero', orden: 2 },
    { moduloCodigo: 'kardex', codigo: 'kardex:traslados',   nombre: 'Traslados',           descripcion: 'Traslado de productos entre sedes',              orden: 3 },
    { moduloCodigo: 'kardex', codigo: 'kardex:combos',      nombre: 'Kits / Packs',        descripcion: 'Kits de productos para venta por mayor',          orden: 4 },
    { moduloCodigo: 'kardex', codigo: 'kardex:movimientos', nombre: 'Movimientos',         descripcion: 'Movimientos de entrada y salida de productos',   orden: 5 },
    // Comprobantes
    { moduloCodigo: 'comprobantes', codigo: 'comprobantes:lista',      nombre: 'Comprobantes SUNAT', descripcion: 'Listado de comprobantes electrónicos',      orden: 1 },
    { moduloCodigo: 'comprobantes', codigo: 'comprobantes:emitir',     nombre: 'Crear comprobantes', descripcion: 'Emisión de nuevos comprobantes electrónicos', orden: 2 },
    { moduloCodigo: 'comprobantes', codigo: 'comprobantes:informales', nombre: 'Notas de ventas',    descripcion: 'Comprobantes informales y notas de pedido',  orden: 3 },
    // Cotizaciones
    { moduloCodigo: 'cotizaciones', codigo: 'cotizaciones:lista', nombre: 'Ver cotizaciones',  descripcion: 'Listado de cotizaciones generadas',   orden: 1 },
    { moduloCodigo: 'cotizaciones', codigo: 'cotizaciones:nueva', nombre: 'Nueva cotización',  descripcion: 'Crear y emitir nuevas cotizaciones',  orden: 2 },
    // Compras
    { moduloCodigo: 'compras', codigo: 'compras:gestion',     nombre: 'Gestión de compras', descripcion: 'Registrar y gestionar órdenes de compra', orden: 1 },
    { moduloCodigo: 'compras', codigo: 'compras:proveedores', nombre: 'Proveedores',        descripcion: 'Gestión del catálogo de proveedores',     orden: 2 },
    // Reportes
    { moduloCodigo: 'reportes', codigo: 'reportes:formal',   nombre: 'Reportes formales',   descripcion: 'Reportes de contabilidad y facturación SUNAT', orden: 1 },
    { moduloCodigo: 'reportes', codigo: 'reportes:informal', nombre: 'Reportes informales', descripcion: 'Reportes de notas de venta y arqueo de caja',  orden: 2 },
    // Tienda
    { moduloCodigo: 'tienda', codigo: 'tienda:configuracion', nombre: 'Configuración',  descripcion: 'Configuración del diseño y datos de la tienda', orden: 1 },
    { moduloCodigo: 'tienda', codigo: 'tienda:pedidos',       nombre: 'Pedidos',        descripcion: 'Gestión de pedidos recibidos por la tienda',    orden: 2 },
    { moduloCodigo: 'tienda', codigo: 'tienda:modificadores', nombre: 'Modificadores',  descripcion: 'Modificadores y opciones de productos',         orden: 3 },
  ];

  for (const sub of subModulosData) {
    const modulo = await prisma.modulo.findFirst({ where: { codigo: sub.moduloCodigo, producto: 'facturacion' } });
    if (!modulo) {
      console.log(`⚠️  Módulo '${sub.moduloCodigo}' no encontrado, saltando submódulo '${sub.codigo}'`);
      continue;
    }
    await prisma.subModulo.upsert({
      where: { codigo: sub.codigo },
      update: { nombre: sub.nombre, descripcion: sub.descripcion, orden: sub.orden, activo: true },
      create: { moduloId: modulo.id, codigo: sub.codigo, nombre: sub.nombre, descripcion: sub.descripcion, orden: sub.orden, activo: true },
    });
    console.log(`✅ SubMódulo '${sub.codigo}' creado/actualizado`);
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
