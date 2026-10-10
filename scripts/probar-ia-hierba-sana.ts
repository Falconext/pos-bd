/**
 * La suite de aceptación del cliente, corrida contra el sistema de verdad.
 *
 * Hierba Sana puso la vara en su propio banco de pruebas: correcto 2 puntos,
 * parcial 1, error crítico 0, y 90% o más para pasar a producción. Esto la
 * ejecuta sobre la BD local y Gemini real, y la puntúa.
 *
 * Las comprobaciones son MECÁNICAS a propósito. Un juez con IA cuesta otra
 * llamada por caso, no es reproducible y puede equivocarse justo donde más
 * importa. Lo que no se puede comprobar sin criterio humano se deja marcado
 * para revisión en vez de fingir que está medido.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/probar-ia-hierba-sana.ts [idCaso]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeminiService } from '../src/gemini/gemini.service';
import {
  IaVentasService,
  MensajeConversacion,
} from '../src/leads/leads-ia.service';
import { RagVentasService } from '../src/leads/leads-rag.service';
import { LeadsPedidoService } from '../src/leads/leads-pedido.service';
import { LeadsMessageProcessor } from '../src/leads/leads-message.processor';
import { esDespedidaClara } from '../src/leads/leads-repeticion';
import { LeadsEmbudoService } from '../src/leads/leads-embudo.service';
import { LeadsConsultasService } from '../src/leads/leads-consultas.service';

const EMPRESA_ID = 89;
/** El plan gratuito corta a las 15 peticiones por minuto. */
const PAUSA_MS = 9000;

interface Comprobaciones {
  usaHerramienta?: string;
  sinHerramientas?: boolean;
  respuestas?: number;
  preciosDelCatalogo?: boolean;
  contiene?: string;
  noContiene?: string;
  conversacionCerrada?: boolean;
  zonaResuelta?: string;
}

interface Caso {
  id: string;
  criticidad: 'critica' | 'alta' | 'media';
  fuente: string;
  mensajes: string[];
  espera: string;
  comprueba: Comprobaciones;
}

function delEnvFile(clave: string): string | undefined {
  return fs
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${clave}=`))
    ?.slice(clave.length + 1)
    .replace(/^["']|["']$/g, '')
    .trim();
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Las expresiones de los casos se escriben con `(?i)` al principio, que es
 * como se hace en casi todas partes menos en JavaScript. Aquí se traduce al
 * flag que sí entiende.
 */
function expresion(patron: string): RegExp {
  return patron.startsWith('(?i)')
    ? new RegExp(patron.slice(4), 'i')
    : new RegExp(patron);
}

/** Todo importe "S/ NN.NN" que aparece en un texto. */
function preciosDe(texto: string): string[] {
  return (texto.match(/S\/\s?\d+(?:[.,]\d{1,2})?/g) ?? []).map((p) =>
    p.replace(/\s/g, '').replace(',', '.').replace(/\.00$/, ''),
  );
}

async function main() {
  process.env.GEMINI_API_KEY ??= delEnvFile('GEMINI_API_KEY');
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }

  const soloEste = process.argv[2];
  const { casos } = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'test', 'hierba-sana', 'casos.json'),
      'utf-8',
    ),
  ) as { casos: Caso[] };
  const aCorrer = soloEste ? casos.filter((c) => c.id === soloEste) : casos;

  const prisma = new PrismaService();
  const gemini = new GeminiService({
    get: (k: string) => process.env[k],
  } as never);
  const ia = new IaVentasService(gemini);
  const rag = new RagVentasService(prisma, gemini);
  const silencioso = () => Promise.resolve({});
  const pedido = new LeadsPedidoService(
    prisma,
    {
      crearInformal: () =>
        Promise.resolve({ id: 1, serie: 'NV01', correlativo: 1 }),
    } as never,
    { create: silencioso } as never,
    { notificarAdminsEmpresa: silencioso } as never,
  );
  const processor = new LeadsMessageProcessor(
    prisma,
    ia,
    rag,
    {} as never,
    { notificarAdminsEmpresa: silencioso } as never,
    null as never,
    null as never,
    pedido,
    // El embudo y el registro de consultas reales: así el harness también
    // ejercita el CRM, que es parte de lo que el cliente va a probar.
    new LeadsEmbudoService(prisma, { isEnabled: () => false } as never),
    new LeadsConsultasService(prisma),
    // Los disparadores no se ejercitan en el harness: mandarían WhatsApps.
    { programar: async () => ({ programado: false }), cancelar: async () => ({ cancelados: 0 }), atenderSiEsBaja: async () => ({ eraBaja: false }) } as never,
    null as never,
  );

  // Todos los nombres y precios del catálogo, para detectar inventos.
  const catalogo = await prisma.producto.findMany({
    where: { empresaId: EMPRESA_ID },
    select: { precioUnitario: true },
  });
  const preciosReales = new Set(
    catalogo.map((p) => `S/${Number(p.precioUnitario)}`),
  );

  const contexto = fs.readFileSync(
    path.join(os.homedir(), 'Downloads', 'CONTEXTO_IA_VENTAS_HIERBA_SANA.txt'),
    'utf-8',
  );
  const businessContext = `Negocio: Hierba Sana (rubro: productos naturales).\n${contexto}`;
  const config = await pedido.configDe(EMPRESA_ID);
  const negocio = {
    nombre: 'Hierba Sana',
    rubro: 'productos naturales',
    asesor: config.asesor ?? null,
    contexto: businessContext,
  };

  let puntos = 0;
  const criticosFallados: string[] = [];

  for (const caso of aCorrer) {
    await prisma.leadConversacion.deleteMany({
      where: {
        empresaId: EMPRESA_ID,
        telefonoProspecto: `51900${caso.id.slice(0, 6)}`,
      },
    });
    const conv = await prisma.leadConversacion.create({
      data: {
        empresaId: EMPRESA_ID,
        telefonoProspecto: `51900${caso.id.slice(0, 6)}`,
      },
    });

    const historial: MensajeConversacion[] = [];
    const fallos: string[] = [];
    let respuestas = 0;
    let ultima = '';
    let llamadas: string[] = [];
    let zona: string | undefined;

    // Los mensajes seguidos van en UN solo turno, como hace el processor: si
    // el harness respondiera a cada uno, estaría midiendo algo que el sistema
    // real no hace, y la agrupación (A2) nunca se pondría a prueba.
    // "__respuesta__" separa turnos: lo que viene después lo dice el cliente
    // tras haber recibido una respuesta.
    const turnos: string[][] = [[]];
    for (const m of caso.mensajes) {
      if (m === '__respuesta__') turnos.push([]);
      else turnos[turnos.length - 1].push(m);
    }

    try {
      for (const lote of turnos.filter((t) => t.length)) {
        for (const m of lote) historial.push({ role: 'user', content: m });
        const mensaje = lote.join('\n');
        const ejecutor = (
          processor as unknown as {
            crearEjecutor: (
              e: number,
              c: number,
              t: string,
              f: Set<number>,
            ) => (n: string, a: Record<string, unknown>) => Promise<unknown>;
          }
        ).crearEjecutor(EMPRESA_ID, conv.id, '51999999999', new Set());

        // Una despedida clara cierra la conversación: es lo que hace el
        // processor y lo que el caso comprueba.
        const cerrar = esDespedidaClara(mensaje);
        const res = await ia.generarRespuesta(
          historial,
          businessContext,
          historial.length,
          ejecutor,
          negocio,
        );
        respuestas++;
        ultima = res.reply;
        llamadas = res.llamadas.map((l) => l.nombre);
        historial.push({ role: 'assistant', content: res.reply });
        if (cerrar) {
          await prisma.leadConversacion.update({
            where: { id: conv.id },
            data: { estado: 'CERRADA' },
          });
        }
        await esperar(PAUSA_MS);
      }

      const borrador = await prisma.leadPedidoBorrador.findUnique({
        where: { conversacionId: conv.id },
      });
      zona = borrador?.zona ?? undefined;
      const estado = await prisma.leadConversacion.findUnique({
        where: { id: conv.id },
        select: { estado: true },
      });

      const c = caso.comprueba;
      if (c.usaHerramienta && !llamadas.includes(c.usaHerramienta)) {
        fallos.push(
          `no llamó a ${c.usaHerramienta} (llamó: ${llamadas.join(', ') || 'nada'})`,
        );
      }
      if (c.sinHerramientas && llamadas.length) {
        fallos.push(
          `llamó herramientas que no hacían falta: ${llamadas.join(', ')}`,
        );
      }
      if (c.respuestas != null && respuestas !== c.respuestas) {
        fallos.push(`${respuestas} respuesta(s), se esperaba ${c.respuestas}`);
      }
      if (c.preciosDelCatalogo) {
        const inventados = preciosDe(ultima).filter(
          (p) => !preciosReales.has(p),
        );
        // Un total (productos + envío) no está en el catálogo y es legítimo.
        if (inventados.length && !/total|env[íi]o|pagar/i.test(ultima)) {
          fallos.push(
            `precios que no están en el catálogo: ${inventados.join(', ')}`,
          );
        }
      }
      if (c.contiene && !expresion(c.contiene).test(ultima)) {
        fallos.push(`la respuesta no contiene ${c.contiene}`);
      }
      if (c.noContiene && expresion(c.noContiene).test(ultima)) {
        fallos.push(`la respuesta contiene lo que no debía: ${c.noContiene}`);
      }
      if (c.conversacionCerrada && estado?.estado !== 'CERRADA') {
        fallos.push(
          `la conversación quedó ${estado?.estado}, se esperaba CERRADA`,
        );
      }
      if (c.zonaResuelta && zona !== c.zonaResuelta) {
        fallos.push(
          `zona ${zona ?? 'sin resolver'}, se esperaba ${c.zonaResuelta}`,
        );
      }
    } catch (e) {
      fallos.push(`ERROR: ${(e as Error).message.slice(0, 120)}`);
    }

    const nota = fallos.length === 0 ? 2 : 0;
    puntos += nota;
    if (nota === 0 && caso.criticidad === 'critica')
      criticosFallados.push(caso.id);

    const marca = nota === 2 ? '✔' : '✗';
    console.log(`${marca} ${caso.id.padEnd(30)} ${caso.espera}`);
    for (const f of fallos) console.log(`    ↳ ${f}`);
    if (nota === 0) {
      console.log(`    respuesta: ${ultima.replace(/\n/g, ' ').slice(0, 180)}`);
    }

    await prisma.leadConversacion.deleteMany({ where: { id: conv.id } });
  }

  const maximo = aCorrer.length * 2;
  const pct = maximo ? Math.round((puntos / maximo) * 100) : 0;
  console.log(`\n${puntos}/${maximo} puntos — ${pct}%`);
  console.log(
    pct >= 90
      ? 'APTO para producción según la vara del cliente (≥ 90%).'
      : pct >= 80
        ? 'Entre 80 y 90: ajustar el prompt.'
        : 'Por debajo de 80: revisión estructural.',
  );
  if (criticosFallados.length) {
    console.log(`⚠ Fallaron casos CRÍTICOS: ${criticosFallados.join(', ')}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
