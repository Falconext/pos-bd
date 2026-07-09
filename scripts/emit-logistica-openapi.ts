/**
 * Emite el OpenAPI de la API pública de Logística a un archivo JSON, SIN levantar
 * el server ni conectar a la base de datos.
 *
 *   npm run openapi:logistica
 *   → backend/openapi/logistica.generated.json
 *
 * Usa el modo `preview` de Nest: instancia el grafo de módulos para descubrir
 * rutas/DTOs, pero NO ejecuta los ciclos de vida de los providers (sin Prisma
 * connect, sin scheduler, sin seed). Ideal para el pipeline docs-as-code.
 *
 * IMPORTANTE (paralelismo): escribe a un archivo de STAGING nuevo. NO copiar a
 * falconext-developers/public/openapi todavía — la integración con el portal se
 * hace después, validando con spectral + oasdiff.
 */
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { AppModule } from '../src/app.module';
import { buildLogisticaDocument } from '../src/logistica/openapi/logistica-openapi';

async function main() {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });

  const document = buildLogisticaDocument(app);
  await app.close();

  const outPath = resolve(__dirname, '../openapi/logistica.generated.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', 'utf8');

  const rutas = Object.keys(document.paths ?? {});
  const schemas = Object.keys(document.components?.schemas ?? {});
  // eslint-disable-next-line no-console
  console.log(
    `✅ OpenAPI de Logística emitido: ${outPath}\n` +
      `   ${rutas.length} rutas · ${schemas.length} schemas\n` +
      rutas.map((r) => `   • ${r}`).join('\n'),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Error emitiendo OpenAPI de Logística:', err);
  process.exit(1);
});
