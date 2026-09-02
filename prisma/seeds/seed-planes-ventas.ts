/**
 * Crea/actualiza los planes del producto de IA de Ventas:
 *   - Ventas Start / Pro / Scale  → solo el módulo `leads` + tope mensual de leads.
 *   - Full (Facturación + Ventas)  → TODOS los módulos de facturación + leads.
 *
 * Idempotente (upsert por nombre+plataforma+producto). Ejecuta:
 *   npx ts-node -r tsconfig-paths/register prisma/seeds/seed-planes-ventas.ts [plataforma]
 * plataforma por defecto: 'falconext'.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PLATAFORMA = process.argv[2] || 'falconext';
// Los módulos "base" (facturación completa) viven bajo producto='facturacion'.
const PRODUCTO_MODULOS = 'facturacion';

interface DefPlan {
  nombre: string;
  producto: string; // producto de destino que filtra el plan (ventas / full)
  costo: number;
  maxLeadsMes: number | null;
  modulos: 'solo-leads' | 'todos';
  descripcion: string;
}

const PLANES: DefPlan[] = [
  { nombre: 'Ventas Start', producto: 'ventas', costo: 149, maxLeadsMes: 500, modulos: 'solo-leads', descripcion: 'IA de Ventas por WhatsApp — hasta 500 leads/mes' },
  { nombre: 'Ventas Pro', producto: 'ventas', costo: 249, maxLeadsMes: 1500, modulos: 'solo-leads', descripcion: 'IA de Ventas por WhatsApp — hasta 1,500 leads/mes' },
  { nombre: 'Ventas Scale', producto: 'ventas', costo: 399, maxLeadsMes: 5000, modulos: 'solo-leads', descripcion: 'IA de Ventas por WhatsApp — hasta 5,000 leads/mes' },
  { nombre: 'Full', producto: 'full', costo: 299, maxLeadsMes: 1500, modulos: 'todos', descripcion: 'Todo Falconext (facturación completa) + IA de Ventas (1,500 leads/mes)' },
];

async function asegurarModuloLeads() {
  const existente = await prisma.modulo.findFirst({ where: { codigo: 'leads', producto: PRODUCTO_MODULOS } });
  if (existente) return existente;
  return prisma.modulo.create({
    data: {
      codigo: 'leads',
      producto: PRODUCTO_MODULOS,
      nombre: 'IA de Ventas',
      descripcion: 'Asesor por WhatsApp que califica prospectos (BANT) y avisa leads calientes',
      icono: 'solar:chat-round-dots-bold-duotone',
      orden: 13,
    },
  });
}

async function main() {
  console.log(`🌱 Planes de Ventas — plataforma='${PLATAFORMA}', producto por plan`);
  const moduloLeads = await asegurarModuloLeads();
  const modulosFacturacion = await prisma.modulo.findMany({ where: { producto: PRODUCTO_MODULOS } });

  for (const def of PLANES) {
    const plan = await prisma.plan.upsert({
      where: { nombre_plataforma_producto: { nombre: def.nombre, plataforma: PLATAFORMA, producto: def.producto } },
      update: { costo: def.costo, maxLeadsMes: def.maxLeadsMes, descripcion: def.descripcion },
      create: {
        nombre: def.nombre,
        plataforma: PLATAFORMA,
        producto: def.producto,
        costo: def.costo,
        maxLeadsMes: def.maxLeadsMes,
        descripcion: def.descripcion,
        duracionDias: 30,
      },
    });

    const modulosDelPlan =
      def.modulos === 'todos' ? modulosFacturacion : [moduloLeads];

    for (const m of modulosDelPlan) {
      await prisma.planModulo.upsert({
        where: { planId_moduloId: { planId: plan.id, moduloId: m.id } },
        update: {},
        create: { planId: plan.id, moduloId: m.id },
      });
    }
    console.log(`  ✅ ${def.nombre} (S/${def.costo}, tope ${def.maxLeadsMes ?? '∞'} leads) — ${modulosDelPlan.length} módulos`);
  }
  console.log('Listo.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
