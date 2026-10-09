import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Registra el módulo 'logistica' bajo su propio producto 'logistica' (además
 * del registro existente bajo 'facturacion'). Idempotente y sin efectos
 * secundarios sobre planes existentes (a diferencia de seed-modulos.ts).
 *
 * Habilita el modelo C: Logística como producto standalone Y como add-on de
 * facturación. Después de correrlo, crea el plan de Logística desde
 * Sistema → Planes (producto "Logística").
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/seed-producto-logistica.ts
 */
async function main() {
  console.log('🌱 Registrando módulo Logística bajo el producto "logistica"...');

  const facturacion = await prisma.modulo.findFirst({
    where: { codigo: 'logistica', producto: 'facturacion' },
  });

  const data = {
    codigo: 'logistica',
    nombre: facturacion?.nombre ?? 'Logística',
    descripcion:
      facturacion?.descripcion ??
      'Gestión de despachos, pedidos, vehículos y rutas',
    icono: facturacion?.icono ?? 'solar:routing-2-bold-duotone',
    orden: 1,
    producto: 'logistica',
  };

  const modulo = await prisma.modulo.upsert({
    where: { codigo_producto: { codigo: 'logistica', producto: 'logistica' } },
    update: data,
    create: data,
  });

  console.log(`✅ Módulo Logística (producto: logistica) listo (id=${modulo.id}).`);

  // ── Plan "Logística" de ejemplo por plataforma (idempotente) ───────────────
  const plataformas = ['falconext', 'krezka'] as const;
  for (const plataforma of plataformas) {
    const planData = {
      nombre: 'Logística',
      plataforma,
      producto: 'logistica',
      descripcion:
        'Plan de operaciones logísticas: despachos, pedidos, flota, zonas y tracking.',
      costo: 99,
      duracionDias: 30,
      tipoFacturacion: 'MENSUAL',
      limiteUsuarios: 5,
      maxSedes: 1,
      esPrueba: false,
    };

    const plan = await prisma.plan.upsert({
      where: {
        nombre_plataforma_producto: {
          nombre: 'Logística',
          plataforma,
          producto: 'logistica',
        },
      },
      update: { descripcion: planData.descripcion },
      create: planData,
    });

    // Enlazar el módulo logística al plan (idempotente)
    const yaAsignado = await prisma.planModulo.findUnique({
      where: { planId_moduloId: { planId: plan.id, moduloId: modulo.id } },
    });
    if (!yaAsignado) {
      await prisma.planModulo.create({
        data: { planId: plan.id, moduloId: modulo.id },
      });
    }
    console.log(
      `✅ Plan "Logística" (${plataforma}/logistica) listo con el módulo asignado (id=${plan.id}).`,
    );
  }

  console.log('');
  console.log('👉 Siguiente paso:');
  console.log('   1. Sistema → Planes → edita el plan "Logística" (precio/duración/límites).');
  console.log('   2. Crea/edita la empresa con producto "Logística" y ese plan → verá solo Logística.');
  console.log('');
  console.log('   Para el combo facturación+logística: en un plan de producto');
  console.log('   "Facturación" agrega el módulo Logística entre sus módulos.');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
