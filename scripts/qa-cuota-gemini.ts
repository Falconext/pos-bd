/**
 * ¿La clave de Gemini está en plan gratuito o de pago?
 *
 * Mirar la página de facturación no basta: lo que decide es a qué PROYECTO
 * pertenece la clave que usa el backend. Si la clave vive en un proyecto que
 * no está vinculado a la cuenta de facturación, se paga y la clave sigue en
 * gratuito.
 *
 * Esto lo resuelve sin ambigüedad: dispara peticiones mínimas hasta completar
 * las que se le pidan o hasta chocar con el límite, y al chocar imprime el
 * nombre de la métrica. Si dice `free_tier`, la clave NO está en pago.
 *
 *   npx ts-node --transpile-only scripts/qa-cuota-gemini.ts [clave] [nº peticiones]
 *
 * Sin argumentos usa GEMINI_API_KEY del entorno o del .env. Para comprobar la
 * clave de producción, pégala como primer argumento.
 */
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const PETICIONES_POR_DEFECTO = 20;
/** El plan gratuito corta en 15 por minuto; 20 lo cruza sin gastar casi nada. */

function delEnvFile(clave: string): string | undefined {
  const ruta = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(ruta)) return undefined;
  return fs
    .readFileSync(ruta, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${clave}=`))
    ?.slice(clave.length + 1)
    .replace(/^["']|["']$/g, '')
    .trim();
}

async function main() {
  const apiKey =
    process.argv[2] ||
    process.env.GEMINI_API_KEY ||
    delEnvFile('GEMINI_API_KEY');
  if (!apiKey)
    throw new Error('No hay clave: pásala como argumento o en .env.');
  const total = Number(process.argv[3]) || PETICIONES_POR_DEFECTO;

  console.log(`Clave: ${apiKey.slice(0, 10)}…${apiKey.slice(-4)}`);
  console.log(`Disparando ${total} peticiones mínimas…\n`);

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-flash-lite-latest',
  });

  let ok = 0;
  for (let i = 1; i <= total; i++) {
    try {
      await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
        generationConfig: { maxOutputTokens: 1 },
      });
      ok++;
      process.stdout.write('.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('429')) {
        console.log(
          `\n\n✗ Error distinto del límite en la petición ${i}:\n${msg}`,
        );
        process.exit(1);
      }
      const metrica =
        /quotaMetric":"([^"]+)"/.exec(msg)?.[1] ?? '(no reportada)';
      const esGratuito = /free_tier/.test(msg);
      console.log(`\n\nLímite alcanzado tras ${ok} petición(es).`);
      console.log(`Métrica: ${metrica}`);
      console.log(
        esGratuito
          ? '\n⚠ PLAN GRATUITO. Esta clave NO está en pago: o falta configurar el\n' +
              '  prepago, o la clave pertenece a un proyecto que no está vinculado a\n' +
              '  la cuenta de facturación. Revísalo en AI Studio → Claves de API.'
          : '\n✔ Plan de PAGO (el límite que se alcanzó no es el gratuito).',
      );
      process.exit(0);
    }
  }

  console.log(
    `\n\n✔ ${ok} peticiones seguidas sin tocar el límite. El plan gratuito corta\n` +
      '  en 15 por minuto, así que esta clave está en plan de PAGO.',
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
