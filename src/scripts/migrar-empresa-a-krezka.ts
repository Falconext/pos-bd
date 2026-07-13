import { PrismaClient } from '@prisma/client';

/**
 * Migra UNA empresa (por RUC) del brand `falconext` al brand `krezka`.
 *
 * Contexto: la plataforma unifica todo a Krezka. El brand (`Empresa.brand`)
 * define el scoping del listado de admin y el portal de login válido para los
 * usuarios de negocio de la empresa (`app.krezka.com` en vez de `app.falconext.pe`).
 *
 * CONSECUENCIAS al aplicar (esperadas, no son errores):
 *   1. La empresa DESAPARECE del listado de cualquier ADMIN_SISTEMA scopeado a
 *      FALCONEXT (p. ej. Diego). Solo la verá un admin scopeado a KREZKA o sin scope.
 *   2. Los usuarios de negocio de la empresa (ADMIN_EMPRESA/USUARIO_EMPRESA)
 *      deberán loguearse desde el portal Krezka (app.krezka.com), no Falconext.
 *      (ADMIN_SISTEMA y RESELLER pueden entrar desde cualquier portal, no se afectan.)
 *
 * Seguro por defecto: sin `--apply` solo muestra el antes/después (dry-run).
 *
 * Uso:
 *   npx ts-node src/scripts/migrar-empresa-a-krezka.ts            # dry-run
 *   npx ts-node src/scripts/migrar-empresa-a-krezka.ts --apply    # aplica
 *
 * Reversible: cambiar TARGET_BRAND a 'falconext' y volver a correr con --apply.
 */

const prisma = new PrismaClient();

const RUC = '20524076307';
const TARGET_BRAND = 'krezka';

async function main() {
  const apply = process.argv.includes('--apply');

  const empresa = await prisma.empresa.findFirst({
    where: { ruc: RUC },
    select: {
      id: true,
      ruc: true,
      razonSocial: true,
      nombreComercial: true,
      brand: true,
      producto: true,
      estado: true,
    },
  });

  if (!empresa) {
    console.error(`❌ No existe ninguna empresa con RUC ${RUC} en esta base de datos.`);
    console.error(
      '   Verifica que DATABASE_URL apunte a la BD correcta (¿producción?).',
    );
    process.exit(1);
  }

  console.log('🏢 Empresa encontrada:');
  console.table([
    {
      id: empresa.id,
      ruc: empresa.ruc,
      razonSocial: empresa.razonSocial,
      brandActual: empresa.brand,
      producto: empresa.producto,
      estado: empresa.estado,
    },
  ]);

  if (empresa.brand === TARGET_BRAND) {
    console.log(`✅ La empresa ya está en brand="${TARGET_BRAND}". Nada que hacer.`);
    return;
  }

  if (!apply) {
    console.log(
      `\n🔎 DRY-RUN: se cambiaría brand "${empresa.brand}" → "${TARGET_BRAND}".`,
    );
    console.log('   Para aplicar de verdad, vuelve a correr con:  --apply');
    return;
  }

  const actualizada = await prisma.empresa.update({
    where: { id: empresa.id },
    data: { brand: TARGET_BRAND },
    select: { id: true, ruc: true, razonSocial: true, brand: true },
  });

  console.log(`\n✅ Migración aplicada:`);
  console.table([actualizada]);
  console.log(
    `\n⚠️  Recuerda: los usuarios de negocio de "${actualizada.razonSocial}" ahora deben` +
      ` ingresar desde app.krezka.com (no app.falconext.pe).`,
  );
}

main()
  .catch((e) => {
    console.error('❌ Error en la migración:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
