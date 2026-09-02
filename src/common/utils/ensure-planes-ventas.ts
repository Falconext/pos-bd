import { PrismaService } from '../../prisma/prisma.service';

/**
 * Asegura (idempotente) los planes de IA de Ventas en la BD. Se llama al arrancar
 * la app, así se crean en cada deploy SIN depender de migraciones de datos
 * (el deploy sincroniza el schema con `db push`, que NO ejecuta INSERTs).
 *
 * - Ventas Start/Pro/Scale  → producto 'ventas', solo el módulo `leads` + tope de leads.
 * - Full                    → producto 'full', todos los módulos de facturación + leads.
 * Se crean para las plataformas 'falconext' y 'krezka'.
 */
const PLATAFORMAS = ['falconext', 'krezka'];

interface DefPlan {
  nombre: string;
  producto: string;
  costo: number;
  maxLeadsMes: number | null;
  modulos: 'solo-leads' | 'todos';
  descripcion: string;
}

const PLANES: DefPlan[] = [
  { nombre: 'Ventas Start', producto: 'ventas', costo: 149, maxLeadsMes: 500, modulos: 'solo-leads', descripcion: 'IA de Ventas por WhatsApp — hasta 500 leads/mes' },
  { nombre: 'Ventas Pro', producto: 'ventas', costo: 249, maxLeadsMes: 1500, modulos: 'solo-leads', descripcion: 'IA de Ventas por WhatsApp — hasta 1,500 leads/mes' },
  { nombre: 'Ventas Scale', producto: 'ventas', costo: 399, maxLeadsMes: 5000, modulos: 'solo-leads', descripcion: 'IA de Ventas por WhatsApp — hasta 5,000 leads/mes' },
  { nombre: 'Full', producto: 'full', costo: 299, maxLeadsMes: 1500, modulos: 'todos', descripcion: 'Todo (facturación completa) + IA de Ventas (1,500 leads/mes)' },
];

export async function ensurePlanesVentas(prisma: PrismaService): Promise<void> {
  // 1) Asegurar el módulo 'leads'
  const moduloLeads =
    (await prisma.modulo.findFirst({ where: { codigo: 'leads', producto: 'facturacion' } })) ??
    (await prisma.modulo.create({
      data: {
        codigo: 'leads',
        producto: 'facturacion',
        nombre: 'IA de Ventas',
        descripcion: 'Asesor por WhatsApp que califica prospectos (BANT) y avisa leads calientes',
        icono: 'solar:chat-round-dots-bold-duotone',
        orden: 13,
      },
    }));

  const modulosFacturacion = await prisma.modulo.findMany({ where: { producto: 'facturacion' } });

  for (const plataforma of PLATAFORMAS) {
    for (const def of PLANES) {
      const plan = await prisma.plan.upsert({
        where: { nombre_plataforma_producto: { nombre: def.nombre, plataforma, producto: def.producto } },
        update: { costo: def.costo, maxLeadsMes: def.maxLeadsMes, descripcion: def.descripcion },
        create: {
          nombre: def.nombre,
          plataforma,
          producto: def.producto,
          costo: def.costo,
          maxLeadsMes: def.maxLeadsMes,
          descripcion: def.descripcion,
          duracionDias: 30,
        },
      });

      const modulosDelPlan = def.modulos === 'todos' ? modulosFacturacion : [moduloLeads];
      for (const m of modulosDelPlan) {
        await prisma.planModulo.upsert({
          where: { planId_moduloId: { planId: plan.id, moduloId: m.id } },
          update: {},
          create: { planId: plan.id, moduloId: m.id },
        });
      }
    }
  }
}
