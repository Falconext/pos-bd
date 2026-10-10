/**
 * QA funcional de la IA de Ventas contra el catálogo real, en LOCAL.
 *
 * Monta las piezas de verdad —declaraciones de herramientas, ejecutor del
 * processor, Gemini, base de datos— y le hace al asistente las preguntas del
 * banco de pruebas del cliente. WhatsApp va simulado: nada sale a Meta.
 *
 * Lo que responde:
 *  - ¿el modelo llama a las herramientas, o sigue improvisando?
 *  - ¿los precios salen del catálogo o se los inventa?
 *  - ¿una pregunta comercial dispara búsquedas que no hacen falta?
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-ia-hierba-sana.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeminiService } from '../src/gemini/gemini.service';
import { IaVentasService } from '../src/leads/leads-ia.service';
import { LeadsMessageProcessor } from '../src/leads/leads-message.processor';
import { LeadsEmbudoService } from '../src/leads/leads-embudo.service';
import { LeadsConsultasService } from '../src/leads/leads-consultas.service';

const EMPRESA_ID = 89;

/** Preguntas del banco del cliente, con lo que debe pasar en cada una. */
const CASOS: { id: string; mensaje: string; espera: string }[] = [
  {
    id: 'E01 producto específico',
    mensaje: 'Hola, tienen berberina?',
    espera: 'busca y responde con el precio exacto del catálogo',
  },
  {
    id: 'E02 consulta de precio',
    mensaje: 'Cuánto cuesta la moringa?',
    espera: 'busca y da el precio real',
  },
  {
    id: 'E03 dolencia',
    mensaje: 'Tengo dolor de rodillas y quiero algo natural.',
    espera: 'busca por la dolencia y propone productos pertinentes',
  },
  {
    id: 'Func.4 producto inventado',
    mensaje: '¿Tiene un producto llamado NaturPlus Max?',
    espera: 'busca y NO inventa; ofrece alternativas o dice que no está',
  },
  {
    id: 'Anti-alucinación: nombre mal escrito',
    mensaje: 'tienes fenocreco?',
    espera: 'reintenta y sugiere Fenogreco en vez de negar',
  },
  {
    id: 'CASO 4 pregunta comercial',
    mensaje: '¿Dónde están ubicados?',
    espera: 'responde del contexto SIN llamar a ninguna herramienta',
  },
  {
    id: 'Foto de producto',
    mensaje: 'me muestras una foto del aceite de sacha inchi?',
    espera: 'llama a enviar_foto (o avisa que no hay imagen)',
  },
];

/**
 * Lee una clave del .env sin cargar el archivo entero: el .env de este repo
 * apunta a producción y no queremos que su DATABASE_URL entre al proceso.
 */
function delEnvFile(clave: string): string | undefined {
  const ruta = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(ruta)) return undefined;
  const linea = fs
    .readFileSync(ruta, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${clave}=`));
  return linea
    ?.slice(clave.length + 1)
    .replace(/^["']|["']$/g, '')
    .trim();
}

async function main() {
  process.env.GEMINI_API_KEY ??= delEnvFile('GEMINI_API_KEY');
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }
  if (!process.env.GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY.');

  const prisma = new PrismaService();
  const gemini = new GeminiService({
    get: (k: string) => process.env[k],
  } as never);
  const ia = new IaVentasService(gemini);

  // WhatsApp simulado: registra lo que se habría enviado y no llama a Meta.
  const enviados: string[] = [];
  const whatsapp = {
    enviarImagenUrl: (_t: string, url: string) => {
      enviados.push(`IMAGEN ${url}`);
      return Promise.resolve({ success: true });
    },
  };

  const processor = new LeadsMessageProcessor(
    prisma,
    ia,
    null as never,
    whatsapp as never,
    null as never,
    null as never,
    null as never,
    null as never,
    new LeadsEmbudoService(prisma, { isEnabled: () => false } as never),
    new LeadsConsultasService(prisma),
    // Los disparadores no se ejercitan en el harness: mandarían WhatsApps.
    { programar: async () => ({ programado: false }), cancelar: async () => ({ cancelados: 0 }), atenderSiEsBaja: async () => ({ eraBaja: false }) } as never,
    null as never,
  );

  // Contexto del negocio, igual que en producción.
  const rutaContexto = path.join(
    os.homedir(),
    'Downloads',
    'CONTEXTO_IA_VENTAS_HIERBA_SANA.txt',
  );
  const contexto = fs.existsSync(rutaContexto)
    ? fs.readFileSync(rutaContexto, 'utf-8')
    : '';
  const businessContext = `Negocio: Hierba Sana (rubro: productos naturales).\n${contexto}`;

  const total = await prisma.producto.count({
    where: { empresaId: EMPRESA_ID },
  });
  console.log(`Catálogo local: ${total} productos.\n`);

  let conHerramienta = 0;
  let totalEntrada = 0;
  let totalSalida = 0;
  let turnos = 0;
  for (const caso of CASOS) {
    enviados.length = 0;
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

    const inicio = Date.now();
    try {
      const res = await ia.generarRespuesta(
        [{ role: 'user', content: caso.mensaje }],
        businessContext,
        1,
        ejecutor,
      );
      const ms = Date.now() - inicio;
      console.log(`━━━ ${caso.id}  (${ms} ms)`);
      console.log(`  cliente: ${caso.mensaje}`);
      console.log(`  espera : ${caso.espera}`);
      if (res.llamadas.length) conHerramienta++;
      for (const ll of res.llamadas) {
        const args = JSON.stringify(ll.argumentos);
        const r = ll.resultado as { productos?: unknown[] };
        const resumen = Array.isArray(r?.productos)
          ? `${r.productos.length} producto(s)`
          : JSON.stringify(ll.resultado).slice(0, 90);
        console.log(`  → ${ll.nombre}${args} ⇒ ${resumen}`);
      }
      if (!res.llamadas.length) console.log('  → (ninguna herramienta)');
      if (res.uso) {
        totalEntrada += res.uso.entrada;
        totalSalida += res.uso.salida;
        turnos++;
        console.log(
          `  tokens: ${res.uso.entrada} entrada + ${res.uso.salida} salida` +
            ` en ${res.uso.llamadasAlModelo} llamada(s) al modelo`,
        );
      }
      console.log(
        `  asistente: ${res.reply.replace(/\n/g, '\n             ')}`,
      );
      if (enviados.length) console.log(`  enviado: ${enviados.join(', ')}`);
    } catch (e) {
      console.log(`━━━ ${caso.id}\n  ✗ ERROR: ${(e as Error).message}`);
    }
    console.log();
  }

  console.log(
    `Herramientas usadas en ${conHerramienta}/${CASOS.length} casos.`,
  );
  if (turnos) {
    console.log(
      `\nTokens por turno (promedio de ${turnos}): ` +
        `${Math.round(totalEntrada / turnos)} entrada + ${Math.round(totalSalida / turnos)} salida.`,
    );
    console.log(
      `Una conversación de 8 turnos costaría ~${Math.round((totalEntrada / turnos) * 8)} tokens de entrada ` +
        `y ~${Math.round((totalSalida / turnos) * 8)} de salida.`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
