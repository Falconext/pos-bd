/**
 * B4 — QA de la cascada de búsqueda contra el catálogo real, en LOCAL.
 *
 * Tres escalones: palabras (SQL), parecido por trigramas (SQL) y fichas del
 * RAG (cuesta un embedding). Lo que se verifica es que cada consulta la
 * resuelva el escalón más barato que puede, y que una dolencia —que no se
 * parece al nombre de ningún producto— llegue a las fichas.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-busqueda-cascada.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeminiService } from '../src/gemini/gemini.service';
import { IaVentasService } from '../src/leads/leads-ia.service';
import { RagVentasService } from '../src/leads/leads-rag.service';
import { LeadsMessageProcessor } from '../src/leads/leads-message.processor';
import { HERRAMIENTA_BUSCAR_PRODUCTOS } from '../src/leads/leads-herramientas';

const EMPRESA_ID = 89;

const CONSULTAS: { consulta: string; espera: string }[] = [
  { consulta: 'berberina', espera: 'palabras: nombre exacto' },
  { consulta: 'moringa', espera: 'palabras: nombre exacto' },
  { consulta: 'fenocreco', espera: 'parecido: mal escrito' },
  { consulta: 'uña de gato', espera: 'palabras' },
  { consulta: 'dolor de rodillas', espera: 'fichas: es una dolencia' },
  { consulta: 'problemas de próstata', espera: 'fichas: es una dolencia' },
  { consulta: 'xyzqwerty', espera: 'nada en ningún escalón' },
];

function delEnvFile(clave: string): string | undefined {
  const ruta = path.join(__dirname, '..', '.env');
  return fs
    .readFileSync(ruta, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${clave}=`))
    ?.slice(clave.length + 1)
    .replace(/^["']|["']$/g, '')
    .trim();
}

async function main() {
  process.env.GEMINI_API_KEY ??= delEnvFile('GEMINI_API_KEY');
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }

  const prisma = new PrismaService();
  const gemini = new GeminiService({
    get: (k: string) => process.env[k],
  } as never);
  const rag = new RagVentasService(prisma, gemini);
  const processor = new LeadsMessageProcessor(
    prisma,
    new IaVentasService(gemini),
    rag,
    {} as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const ejecutor = (
    processor as unknown as {
      crearEjecutor: (
        e: number,
        c: number,
        t: string,
        f: Set<number>,
      ) => (n: string, a: Record<string, unknown>) => Promise<unknown>;
    }
  ).crearEjecutor(EMPRESA_ID, 1, '51999999999', new Set());

  const fichas = await prisma.leadDocumento.count({
    where: { empresaId: EMPRESA_ID, estado: 'INDEXADO' },
  });
  console.log(
    `Catálogo: ${await prisma.producto.count({ where: { empresaId: EMPRESA_ID } })} productos, ` +
      `${fichas} documento(s) de RAG indexados.\n`,
  );

  for (const caso of CONSULTAS) {
    const inicio = Date.now();
    const r = (await ejecutor(HERRAMIENTA_BUSCAR_PRODUCTOS, {
      consulta: caso.consulta,
    })) as { productos?: { nombre: string; precio: string }[] };
    const ms = Date.now() - inicio;
    const encontrados = r.productos ?? [];
    console.log(`"${caso.consulta}" (${ms} ms) — se espera ${caso.espera}`);
    for (const p of encontrados.slice(0, 3)) {
      console.log(`    ${p.nombre} — ${p.precio}`);
    }
    if (!encontrados.length) console.log('    (sin resultados)');
    console.log();
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
