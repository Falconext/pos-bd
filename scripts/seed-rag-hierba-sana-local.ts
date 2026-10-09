/**
 * Siembra fichas del RAG de Hierba Sana en la base LOCAL, para poder probar el
 * tercer escalón de la búsqueda (B4).
 *
 * No carga las 1,119 fichas: cada fragmento cuesta un embedding y en plan
 * gratuito son 15 por minuto. Toma una muestra de las que mencionan los
 * órganos que aparecen en el banco de pruebas, que es lo que hace falta para
 * verificar que una dolencia llegue a productos reales.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/seed-rag-hierba-sana-local.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeminiService } from '../src/gemini/gemini.service';
import { RagVentasService } from '../src/leads/leads-rag.service';

const EMPRESA_ID = 89;
const ORGANOS = ['Articulaciones', 'Próstata', 'Hígado', 'Riñón'];
/** Fichas por órgano. Pocas: lo que se prueba es el camino, no la cobertura. */
const POR_ORGANO = 6;

function delEnvFile(clave: string): string | undefined {
  return fs
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${clave}=`))
    ?.slice(clave.length + 1)
    .replace(/^["']|["']$/g, '')
    .trim();
}

async function main() {
  process.env.GEMINI_API_KEY ??= delEnvFile('GEMINI_API_KEY');
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost.');
  }

  const dir = path.join(os.homedir(), 'Downloads', 'ENTRENAR_HIERBA_SANA');
  const fichas: string[] = [];
  for (const archivo of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const texto = fs.readFileSync(path.join(dir, archivo), 'utf-8');
    // Las fichas van separadas por línea en blanco y empiezan con el nombre.
    for (const bloque of texto.split(/\n\s*\n/)) {
      if (/\(c[oó]d\.\s*[A-Za-z0-9._-]+\)/i.test(bloque))
        fichas.push(bloque.trim());
    }
  }

  const elegidas: string[] = [];
  for (const organo of ORGANOS) {
    const delOrgano = fichas.filter((f) => f.includes(organo));
    elegidas.push(...delOrgano.slice(0, POR_ORGANO));
  }
  const contenido = [...new Set(elegidas)].join('\n\n');
  console.log(
    `${fichas.length} fichas en disco; se siembran ${new Set(elegidas).size} (${contenido.length} caracteres).`,
  );

  const prisma = new PrismaService();
  const gemini = new GeminiService({
    get: (k: string) => process.env[k],
  } as never);
  const rag = new RagVentasService(prisma, gemini);

  await prisma.leadDocumento.deleteMany({
    where: { empresaId: EMPRESA_ID, titulo: 'QA fichas (muestra)' },
  });
  const doc = await prisma.leadDocumento.create({
    data: {
      empresaId: EMPRESA_ID,
      tipo: 'TEXTO',
      titulo: 'QA fichas (muestra)',
      contenido,
      estado: 'PENDIENTE',
    },
  });
  await rag.indexarDocumento(doc.id, contenido);

  const fragmentos = await prisma.leadFragmento.count({
    where: { documentoId: doc.id },
  });
  const estado = await prisma.leadDocumento.findUnique({
    where: { id: doc.id },
    select: { estado: true, error: true },
  });
  console.log(
    `Documento ${doc.id}: ${estado?.estado}, ${fragmentos} fragmento(s).` +
      (estado?.error ? ` Error: ${estado.error}` : ''),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
