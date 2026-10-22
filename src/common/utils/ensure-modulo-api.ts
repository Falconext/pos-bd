import { PrismaService } from '../../prisma/prisma.service';

/**
 * Asegura (idempotente) el módulo `api` —la API de Krezka para el propio
 * negocio— al arrancar, igual que `ensurePlanesVentas` con `leads`: así existe
 * en cada base sin migraciones de datos.
 *
 * No se asigna a ningún plan: se vende aparte y lo activa el administrador
 * del sistema en Sistema → Planes.
 */
export async function ensureModuloApi(prisma: PrismaService): Promise<void> {
  const existe = await prisma.modulo.findFirst({ where: { codigo: 'api', producto: 'facturacion' } });
  if (existe) return;
  await prisma.modulo.create({
    data: {
      codigo: 'api',
      producto: 'facturacion',
      nombre: 'API de Krezka',
      descripcion: 'Conecta la web o el sistema del negocio con su catálogo y su stock (claves API)',
      icono: 'solar:code-square-bold-duotone',
      orden: 14,
    },
  });
}
