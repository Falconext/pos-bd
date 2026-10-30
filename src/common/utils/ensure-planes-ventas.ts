import { PrismaService } from '../../prisma/prisma.service';

/**
 * Asegura (idempotente) los planes de IA de Ventas en la BD. Se llama al arrancar
 * la app, así se crean en cada deploy SIN depender de migraciones de datos
 * (el deploy sincroniza el schema con `db push`, que NO ejecuta INSERTs).
 *
 * - Ventas Start/Pro/Scale  → producto 'ventas', todos los módulos de facturación + leads + tope de leads.
 * - Full (legacy)           → producto 'full', todos los módulos de facturación + leads.
 * - Prueba Ventas           → la prueba gratis del autoregistro: 7 días, mismos módulos y un
 *                             tope bajo de leads para que una cuenta falsa no queme IA.
 * Se crean para las plataformas 'falconext' y 'krezka'.
 */
const PLATAFORMAS = ['falconext', 'krezka'];

/** Plan con el que arranca quien se registra solo desde la web. */
export const PLAN_PRUEBA_VENTAS = 'Prueba Ventas';
export const DIAS_PRUEBA_VENTAS = 7;

/** Lo que el registro y "elige tu plan" aceptan, y el plan al que corresponde. */
export const PLANES_VENTAS_POR_CLAVE = {
  start: 'Ventas Start',
  pro: 'Ventas Pro',
  scale: 'Ventas Scale',
} as const;
export type ClavePlanVentas = keyof typeof PLANES_VENTAS_POR_CLAVE;

interface DefPlan {
  nombre: string;
  producto: string;
  costo: number;
  maxLeadsMes: number | null;
  modulos: 'solo-leads' | 'todos';
  descripcion: string;
  duracionDias?: number;
  esPrueba?: boolean;
}

const PLANES: DefPlan[] = [
  { nombre: 'Ventas Start', producto: 'ventas', costo: 199, maxLeadsMes: 500, modulos: 'todos', descripcion: 'Facturación SUNAT + IA de Ventas por WhatsApp — 500 leads/mes' },
  { nombre: 'Ventas Pro', producto: 'ventas', costo: 299, maxLeadsMes: 1500, modulos: 'todos', descripcion: 'Facturación SUNAT + IA de Ventas por WhatsApp — 1,500 leads/mes' },
  { nombre: 'Ventas Scale', producto: 'ventas', costo: 499, maxLeadsMes: 5000, modulos: 'todos', descripcion: 'Facturación SUNAT + IA de Ventas por WhatsApp — 5,000 leads/mes' },
  // Legacy: ya no se vende (lo reemplazan los planes Ventas con facturación); se conserva para las empresas que lo tienen.
  { nombre: 'Full', producto: 'full', costo: 299, maxLeadsMes: 1500, modulos: 'todos', descripcion: 'Todo el ERP (facturación completa) + IA de Ventas — 1,500 conversaciones/mes · todo incluido' },
  { nombre: PLAN_PRUEBA_VENTAS, producto: 'ventas', costo: 0, maxLeadsMes: 50, modulos: 'todos', descripcion: `Prueba gratis de ${DIAS_PRUEBA_VENTAS} días — facturación en modo demo + IA de Ventas (50 leads)`, duracionDias: DIAS_PRUEBA_VENTAS, esPrueba: true },
];

/**
 * Límites y features de los planes con facturación incluida (todos menos los
 * de 'solo-leads'). Calcados de "FULL 1000", el plan con el que ya opera un
 * cliente real: sin esto los planes nacían con los valores por defecto del
 * esquema (1 sede, sin tienda, 1 imagen) y "facturación incluida" no era cierto.
 * En límites, 0 = ilimitado.
 */
const LIMITES_CON_FACTURACION = {
  limiteUsuarios: 0,
  maxSedes: 0,
  maxComprobantes: 0,
  maxImagenesProducto: 3,
  maxBanners: 3,
  tieneTienda: true,
  tieneGestionLotes: true,
  tieneGestionProvisiones: true,
};

const FEATURES_CON_FACTURACION = [
  'tieneAnalisisFinancieroAvanzado',
  'tieneAutoGenerarImagen',
  'tieneGestionLotes',
  'tieneGestionProvisiones',
  'tieneLocalizacion',
  'tieneMultiplesSedes',
  'tieneOlva',
  'tieneOlvaGuias',
  'tienePlantillasWhatsApp',
  'tieneShalom',
  'tieneShalomGuias',
  'tieneSire',
  'tieneTienda',
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
      const conFacturacion = def.modulos === 'todos';
      const limites = conFacturacion ? LIMITES_CON_FACTURACION : {};
      const plan = await prisma.plan.upsert({
        where: { nombre_plataforma_producto: { nombre: def.nombre, plataforma, producto: def.producto } },
        update: {
          costo: def.costo,
          maxLeadsMes: def.maxLeadsMes,
          descripcion: def.descripcion,
          duracionDias: def.duracionDias ?? 30,
          esPrueba: def.esPrueba ?? false,
          ...limites,
        },
        create: {
          nombre: def.nombre,
          plataforma,
          producto: def.producto,
          costo: def.costo,
          maxLeadsMes: def.maxLeadsMes,
          descripcion: def.descripcion,
          duracionDias: def.duracionDias ?? 30,
          esPrueba: def.esPrueba ?? false,
          ...limites,
        },
      });

      if (conFacturacion) {
        for (const featureKey of FEATURES_CON_FACTURACION) {
          await prisma.planFeature.upsert({
            where: { planId_featureKey: { planId: plan.id, featureKey } },
            update: { enabled: true },
            create: { planId: plan.id, featureKey, enabled: true },
          });
        }
      }

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
