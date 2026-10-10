/**
 * ¿Gemini cachea solo el prefijo repetido? (caché implícita)
 *
 * El contexto del negocio son las mismas ~3,500 fichas de tokens en cada
 * mensaje. Si Gemini las cobra a precio reducido por venir de caché, no hay
 * nada que construir; si no, hay que forzarlo.
 *
 *   npx ts-node --transpile-only scripts/qa-cache-contexto.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

function delEnvFile(clave: string): string {
  const ruta = path.join(__dirname, '..', '.env');
  const linea = fs
    .readFileSync(ruta, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${clave}=`));
  if (!linea) throw new Error(`Falta ${clave} en .env`);
  return linea
    .slice(clave.length + 1)
    .replace(/^["']|["']$/g, '')
    .trim();
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || delEnvFile('GEMINI_API_KEY');
  const ctx = fs.readFileSync(
    path.join(os.homedir(), 'Downloads', 'CONTEXTO_IA_VENTAS_HIERBA_SANA.txt'),
    'utf-8',
  );
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-flash-lite-latest',
    systemInstruction: ctx,
  });

  console.log(`Contexto del negocio: ${ctx.length} caracteres.\n`);
  let huboCache = false;
  for (const pregunta of ['hola', 'buenas', 'que tal', 'buenos dias']) {
    const r = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: pregunta }] }],
      generationConfig: { maxOutputTokens: 5 },
    });
    const u = r.response.usageMetadata as
      | { promptTokenCount?: number; cachedContentTokenCount?: number }
      | undefined;
    const cacheados = u?.cachedContentTokenCount ?? 0;
    if (cacheados > 0) huboCache = true;
    console.log(
      `"${pregunta}" → entrada ${u?.promptTokenCount}, de caché ${cacheados}`,
    );
  }
  console.log(
    huboCache
      ? '\n✔ Hay caché implícita: el prefijo repetido ya se cobra más barato.'
      : '\n✗ Sin caché: se paga el contexto entero en cada mensaje.',
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
