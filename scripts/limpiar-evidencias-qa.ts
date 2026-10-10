/**
 * Borra del bucket los archivos que subió el QA de D3.
 *
 * El QA por HTTP sube de verdad a S3 (es la única forma de probar que la
 * subida funciona), así que deja basura en un bucket compartido. Esto la
 * saca. Solo toca las claves de `entregas/` que estén registradas en la BD
 * LOCAL: nunca adivina rutas.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { S3Service } from '../src/s3/s3.service';

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost.');
  }
  const prisma = new PrismaService();
  const s3 = new S3Service(new ConfigService());
  s3.onModuleInit();

  const filas = await prisma.evidenciaEntrega.findMany({
    select: { id: true, url: true },
  });
  for (const f of filas) {
    const key = f.url.split('.amazonaws.com/')[1];
    if (!key?.startsWith('entregas/')) {
      console.log(`· saltada (no es de entregas): ${f.url}`);
      continue;
    }
    await s3.deleteFile(key);
    console.log(`✔ borrada de S3: ${key}`);
  }
  await prisma.evidenciaEntrega.deleteMany({});
  console.log(`✔ ${filas.length} fila(s) de evidencia limpiadas en la BD local`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
