import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Crea (o actualiza) un usuario ADMIN_SISTEMA scopeado al entorno KREZKA.
 *
 * Contexto: el rol ADMIN_SISTEMA puede loguearse desde cualquier portal, pero
 * los dashboards de Sistema (p. ej. Sistema-Finanzas) filtran por el campo
 * `usuario.sistemaNegocio` del JWT:
 *   - null      → ve todas las marcas (falconext + krezka)
 *   - 'KREZKA'  → ve solo empresas con `brand = 'krezka'`
 * Este script deja un admin fijado a KREZKA para administrar ese entorno.
 *
 * Idempotente: hace upsert por email; si ya existe, actualiza rol/scope/clave.
 *
 * Uso:
 *   npx ts-node src/scripts/crear-admin-krezka.ts
 *   EMAIL=admin@krezka.com PASSWORD=miClave npx ts-node src/scripts/crear-admin-krezka.ts
 */

const prisma = new PrismaClient();

const EMAIL = process.env.EMAIL || 'admin@krezka.com';
const PASSWORD = process.env.PASSWORD || 'admin123';
const NOMBRE = process.env.NOMBRE || 'Administrador Krezka';

async function main() {
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  // IMPORTANTE: el ADMIN_SISTEMA NO debe tener empresa. El login valida
  // `empresa.fechaExpiracion` ANTES del bypass por rol, así que asociarlo a una
  // empresa con plan vencido bloquearía el acceso. El scoping a KREZKA lo da
  // `sistemaNegocio`, no la empresa del usuario.
  const base = {
    nombre: NOMBRE,
    dni: '00000002',
    celular: '999999998',
    rol: 'ADMIN_SISTEMA' as const,
    estado: 'ACTIVO' as const,
    permisos: 'ALL',
    sistemaNegocio: 'KREZKA',
    empresaId: null,
  };

  const usuario = await prisma.usuario.upsert({
    where: { email: EMAIL },
    update: { password: hashedPassword, ...base },
    create: { email: EMAIL, password: hashedPassword, ...base },
    select: { id: true, email: true, rol: true, sistemaNegocio: true, empresaId: true },
  });

  console.log('✅ Admin de sistema KREZKA listo:');
  console.table([usuario]);
  console.log(`\n🔑 Credenciales: ${EMAIL} / ${PASSWORD}`);
  console.log('🏢 Sin empresa asociada (ADMIN_SISTEMA no la requiere y evita el bloqueo por plan vencido).');
  console.log('🎯 Scope: sistemaNegocio = KREZKA → verá solo empresas brand="krezka".');
  console.log('   Entra desde el frontend krezka (pnpm run dev:krezka) y ve a /administrador/sistema.');
}

main()
  .catch((e) => {
    console.error('❌ Error creando admin KREZKA:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
