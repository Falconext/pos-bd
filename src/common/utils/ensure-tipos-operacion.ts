import { PrismaService } from '../../prisma/prisma.service';

/**
 * Asegura (idempotente) los Tipos de Operación del Catálogo 51 de SUNAT en la BD.
 * Se llama al arrancar la app, así aparecen en cada deploy SIN depender de que
 * alguien corra `pnpm run seed:detracciones` a mano (el deploy sincroniza el
 * schema con `db push`, que NO ejecuta INSERTs).
 *
 * Solo CREA los códigos que faltan: nunca renombra los existentes, porque hay
 * bases antiguas con descripciones propias (ej. 0112 usado como "detracción" en
 * el POS) y cambiarlas rompería el flujo actual.
 */
const TIPOS_OPERACION: Array<{ codigo: string; descripcion: string }> = [
  { codigo: '0101', descripcion: 'VENTA INTERNA' },
  { codigo: '0102', descripcion: 'EXPORTACIÓN' },
  { codigo: '0112', descripcion: 'VENTA INTERNA - ANTICIPOS' },
  { codigo: '0113', descripcion: 'EXPORTACIÓN - ANTICIPOS' },
  { codigo: '0121', descripcion: 'VENTA INTERNA SUJETA A IVAP' },
  {
    codigo: '0200',
    descripcion:
      'EXPORTACIÓN DE SERVICIOS - PRESTACIÓN DE SERVICIOS REALIZADOS EN EL PAÍS',
  },
  {
    codigo: '0201',
    descripcion:
      'EXPORTACIÓN DE SERVICIOS - PRESTACIÓN DE SERVICIOS REALIZADOS ÍNTEGRAMENTE EN EL EXTRANJERO',
  },
  {
    codigo: '0202',
    descripcion:
      'EXPORTACIÓN DE SERVICIOS - SERVICIOS DE HOSPEDAJE NO DOMICILIADOS',
  },
  {
    codigo: '0205',
    descripcion:
      'EXPORTACIÓN DE SERVICIOS - SERVICIOS A NAVES Y AERONAVES DE BANDERA EXTRANJERA',
  },
  {
    codigo: '0206',
    descripcion:
      'EXPORTACIÓN DE SERVICIOS - SERVICIOS COMPLEMENTARIOS AL TRANSPORTE DE CARGA',
  },
  { codigo: '0401', descripcion: 'OPERACIONES SUJETAS A DETRACCIÓN' },
];

export async function ensureTiposOperacion(
  prisma: PrismaService,
): Promise<number> {
  const existentes = await prisma.tipoOperacion.findMany({
    select: { codigo: true },
  });
  const codigos = new Set(existentes.map((t) => t.codigo));

  const faltantes = TIPOS_OPERACION.filter((t) => !codigos.has(t.codigo));
  if (!faltantes.length) return 0;

  // En Postgres la secuencia de IDs quedó desincronizada en bases que se
  // sembraron con IDs explícitos: sin este setval, el primer `create` revienta
  // con "Unique constraint failed on the fields: (id)". Mismo arreglo que usa
  // prisma/seeds/seed-detracciones.ts.
  if (!(process.env.DATABASE_URL || '').startsWith('file:')) {
    try {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"TipoOperacion"', 'id'), coalesce(max(id), 0) + 1, false) FROM "TipoOperacion";`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(
        `   ⚠️ No se pudo sincronizar la secuencia de TipoOperacion: ${message}`,
      );
    }
  }

  let creados = 0;
  for (const tipo of faltantes) {
    try {
      await prisma.tipoOperacion.create({ data: tipo });
      creados++;
    } catch (e) {
      // Otra instancia pudo crearlo en paralelo (unique en `codigo`): no es error.
      const message = e instanceof Error ? e.message : String(e);
      console.warn(
        `   ⚠️ No se pudo crear TipoOperacion ${tipo.codigo}: ${message}`,
      );
    }
  }
  return creados;
}
