/**
 * Script de migración: actualiza los 3 planes simplificados a sus valores v2.
 * Ejecutar en producción: npx ts-node prisma/seeds/update-planes-v2.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const planesV2 = [
  {
    nombre: 'EMPRENDEDOR',
    descripcion: 'Plan Emprendedor — Ideal para negocios que inician',
    costo: 39.90,
    esPrueba: false,
    limiteUsuarios: 2,
    duracionDias: 30,
    tipoFacturacion: 'MENSUAL',
    tieneTienda: false,
    tieneBanners: false,
    tieneGaleria: false,
    tieneCulqi: false,
    tieneDeliveryGPS: false,
    tieneTicketera: false,
    tieneGestionLotes: false,
    tieneGestionProvisiones: false,
    maxComprobantes: 0,   // 0 = ilimitado
    maxSedes: 1,
    maxImagenesProducto: 3,
    maxBanners: 0,
  },
  {
    nombre: 'NEGOCIO',
    descripcion: 'Plan Negocio — Para negocios en crecimiento',
    costo: 69.90,
    esPrueba: false,
    limiteUsuarios: 5,
    duracionDias: 30,
    tipoFacturacion: 'MENSUAL',
    tieneTienda: true,
    tieneBanners: true,
    tieneGaleria: true,
    tieneCulqi: false,
    tieneDeliveryGPS: false,
    tieneTicketera: true,
    tieneGestionLotes: true,
    tieneGestionProvisiones: false,
    maxComprobantes: 0,   // 0 = ilimitado
    maxSedes: 2,
    maxImagenesProducto: 5,
    maxBanners: 5,
  },
  {
    nombre: 'CORPORATIVO',
    descripcion: 'Plan Corporativo — Control total para empresas establecidas',
    costo: 99.90,
    esPrueba: false,
    limiteUsuarios: 15,
    duracionDias: 30,
    tipoFacturacion: 'MENSUAL',
    tieneTienda: true,
    tieneBanners: true,
    tieneGaleria: true,
    tieneCulqi: true,
    tieneDeliveryGPS: true,
    tieneTicketera: true,
    tieneGestionLotes: true,
    tieneGestionProvisiones: true,
    maxComprobantes: 0,   // 0 = ilimitado
    maxSedes: 0,          // 0 = ilimitado
    maxImagenesProducto: 10,
    maxBanners: 20,
  },
];

async function main() {
  console.log('Actualizando planes v2...\n');

  for (const plan of planesV2) {
    const plataforma = 'falconext' as const;
    const producto = 'facturacion' as const;
    const result = await prisma.plan.upsert({
      where: {
        nombre_plataforma_producto: {
          nombre: plan.nombre,
          plataforma,
          producto,
        },
      },
      update: {
        ...plan,
        plataforma,
        producto,
      },
      create: {
        ...plan,
        plataforma,
        producto,
      },
    });
    console.log(`✓ ${result.nombre}: S/ ${result.costo} | maxComprobantes=${result.maxComprobantes} | maxSedes=${result.maxSedes} | limiteUsuarios=${result.limiteUsuarios}`);
  }

  await prisma.plan.updateMany({
    where: {
      OR: [
        { nombre: { equals: 'CORPORATIVO', mode: 'insensitive' } },
        { nombre: { equals: 'COORPORATIVO', mode: 'insensitive' } },
      ],
    },
    data: {
      tieneGestionLotes: true,
      tieneDeliveryGPS: true,
      tieneGestionProvisiones: true,
    },
  });

  console.log('\n✓ Actualización completada.');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
