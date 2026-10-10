/**
 * Calibra el umbral de repetición (A3) con embeddings reales.
 *
 * El 0.8 sale del flujo V20.2 del cliente, pero los embeddings de Gemini dan
 * cosenos altos incluso entre frases poco relacionadas: un umbral demasiado
 * bajo calla respuestas legítimas, que es peor que repetirse. Esto mide dónde
 * caen de verdad los pares que SÍ hay que callar y los que NO.
 *
 *   npx ts-node --transpile-only scripts/qa-umbral-repeticion.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { GeminiService } from '../src/gemini/gemini.service';
import {
  aportaDatoNuevo,
  similitudCoseno,
  UMBRAL_REPETICION,
} from '../src/leads/leads-repeticion';

/** Pares reales de respuestas del asistente, con el veredicto que esperamos. */
const PARES: { caso: string; callar: boolean; a: string; b: string }[] = [
  {
    caso: 'El ejemplo del propio cliente (flujo V20.2)',
    callar: true,
    a: 'Quedo atento para ayudarte a completar tu pedido 😊',
    b: 'Estoy aquí para ayudarte a finalizar tu compra 😊',
  },
  {
    caso: 'Dos invitaciones a agendar, distinta redacción',
    callar: true,
    a: '¡Con gusto! 😊 ¿Deseas que agendemos tu entrega?',
    b: 'Claro que sí 😊 ¿Te ayudo a coordinar el envío?',
  },
  {
    caso: 'Mismo cierre cordial dos veces',
    callar: true,
    a: 'Quedamos atentos si necesitas alguna consulta adicional.',
    b: 'Cualquier consulta adicional, quedamos a tu disposición.',
  },
  {
    caso: 'Cotizar un producto vs. pedir los datos de entrega',
    callar: false,
    a: 'Sí, tenemos Berberina a S/ 45.00. ¿Te la cotizo?',
    b: 'Perfecto, para agendar necesito tu nombre completo.',
  },
  {
    caso: 'Dos presentaciones distintas del mismo producto',
    callar: false,
    a: 'Tenemos Moringa en cápsulas de 100 unidades a S/ 31.00.',
    b: 'Tenemos Harina de Moringa de 150 gr a S/ 10.00.',
  },
  {
    caso: 'Dirección de la tienda vs. costo del delivery',
    callar: false,
    a: 'Estamos en Av. Emancipación 687, interior del Mercado La Merced, stand D-27.',
    b: 'El delivery en Lima cuesta S/ 15.00 y el pago es contraentrega.',
  },
  {
    caso: 'Saludo inicial vs. despedida',
    callar: false,
    a: '¡Hola, bienvenido a Hierba Sana! 🌿 Soy tu asesor de confianza.',
    b: '¡Un gusto ayudarte! Quedamos a tu disposición. 😊🌿',
  },
];

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
  process.env.GEMINI_API_KEY ??= delEnvFile('GEMINI_API_KEY');
  if (!process.env.GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY.');
  const gemini = new GeminiService({
    get: (k: string) => process.env[k],
  } as never);

  const medidos: { callar: boolean; sim: number; caso: string }[] = [];
  for (const par of PARES) {
    const [va, vb] = [
      await gemini.generarEmbedding(par.a),
      await gemini.generarEmbedding(par.b),
    ];
    const sim = similitudCoseno(va, vb);
    medidos.push({ callar: par.callar, sim, caso: par.caso });
    // La regla completa, igual que en el processor: parecido Y sin cifra nueva.
    const calla = sim >= UMBRAL_REPETICION && !aportaDatoNuevo(par.b, [par.a]);
    const soloCoseno = sim >= UMBRAL_REPETICION;
    const ok = calla === par.callar ? '✔' : '✗';
    const okCoseno = soloCoseno === par.callar ? ' ' : '✗';
    console.log(
      `${ok} ${sim.toFixed(3)}  ${(calla ? 'CALLA' : 'responde').padEnd(8)}` +
        ` (se espera ${(par.callar ? 'CALLA' : 'responde').padEnd(8)})` +
        ` [solo coseno: ${okCoseno}]  ${par.caso}`,
    );
  }

  const repetidos = medidos.filter((m) => m.callar).map((m) => m.sim);
  const distintos = medidos.filter((m) => !m.callar).map((m) => m.sim);
  const minRepetido = Math.min(...repetidos);
  const maxDistinto = Math.max(...distintos);

  console.log(
    `\nPares que hay que callar:  ${repetidos.map((s) => s.toFixed(3)).join(', ')}`,
  );
  console.log(
    `Pares que hay que enviar:  ${distintos.map((s) => s.toFixed(3)).join(', ')}`,
  );
  console.log(`\nMenor de los que se callan: ${minRepetido.toFixed(3)}`);
  console.log(`Mayor de los que se envían: ${maxDistinto.toFixed(3)}`);

  if (minRepetido > maxDistinto) {
    const sugerido = (minRepetido + maxDistinto) / 2;
    console.log(
      `\nLos dos grupos no se solapan. Umbral sugerido: ${sugerido.toFixed(2)} (hoy ${UMBRAL_REPETICION}).`,
    );
  } else {
    console.log(
      `\n⚠ Los grupos se solapan: ningún umbral separa bien estos casos con embeddings solos.`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
