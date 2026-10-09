/**
 * QA funcional del flujo de venta completo (C1 a C4), en LOCAL.
 *
 * Simula una conversación de verdad —con Gemini de verdad y el catálogo de
 * verdad— desde "quiero moringa" hasta el pedido registrado, y muestra qué
 * herramienta pide el modelo en cada turno. WhatsApp va simulado: nada sale a
 * Meta.
 *
 * Los mensajes juntan varios datos a propósito: es como escribe la gente, y
 * de paso gasta menos cuota que preguntar de a uno.
 *
 *   export DATABASE_URL=postgresql://postgres:developer@localhost:5432/sistema_mype
 *   npx ts-node --transpile-only scripts/qa-venta-completa.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeminiService } from '../src/gemini/gemini.service';
import { IaVentasService, MensajeConversacion } from '../src/leads/leads-ia.service';
import { RagVentasService } from '../src/leads/leads-rag.service';
import { LeadsPedidoService } from '../src/leads/leads-pedido.service';
import { LeadsMessageProcessor } from '../src/leads/leads-message.processor';

const EMPRESA_ID = 89;
const TELEFONO = '51900000001';
/** Pausa entre turnos: el plan gratuito de Gemini corta a las 15 por minuto. */
const PAUSA_MS = 6000;

const GUION = [
  'hola, quiero 2 moringa en cápsulas, para Miraflores',
  'Juan Pérez, Av. Siempre Viva 123, frente al parque',
  'mañana de 3 a 4 de la tarde, mi celular es 987654321',
  'sí, agéndalo por favor',
];

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

async function main() {
  process.env.GEMINI_API_KEY ??= delEnvFile('GEMINI_API_KEY');
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL no apunta a localhost. QA solo en local.');
  }

  const prisma = new PrismaService();
  const gemini = new GeminiService({
    get: (k: string) => process.env[k],
  } as never);
  const ia = new IaVentasService(gemini);
  const rag = new RagVentasService(prisma, gemini);

  const comprobante = {
    crearInformal: (input: { tipoDoc: string }) => {
      // No se emite nada de verdad: lo que se prueba es que el flujo llegue
      // hasta aquí con los datos completos.
      console.log(`      [comprobante simulado: ${input.tipoDoc}]`);
      return Promise.resolve({ id: 9001, serie: 'NV01', correlativo: 1 });
    },
  };
  const despacho = {
    create: (_c: number, _e: number, dto: Record<string, unknown>) => {
      console.log(`      [despacho simulado] ${JSON.stringify(dto)}`);
      return Promise.resolve({});
    },
  };
  const notificaciones = {
    notificarAdminsEmpresa: (n: { titulo: string }) => {
      console.log(`      [aviso al equipo] ${n.titulo}`);
      return Promise.resolve({});
    },
  };

  const pedido = new LeadsPedidoService(
    prisma,
    comprobante as never,
    despacho as never,
    notificaciones as never,
  );
  const processor = new LeadsMessageProcessor(
    prisma,
    ia,
    rag,
    {} as never,
    notificaciones as never,
    null as never,
    comprobante as never,
    pedido,
    null as never,
  );

  // Conversación limpia para esta corrida.
  await prisma.leadConversacion.deleteMany({
    where: { empresaId: EMPRESA_ID, telefonoProspecto: TELEFONO },
  });
  const conv = await prisma.leadConversacion.create({
    data: {
      empresaId: EMPRESA_ID,
      telefonoProspecto: TELEFONO,
      nombreProspecto: 'QA',
    },
  });

  const contexto = fs.readFileSync(
    path.join(os.homedir(), 'Downloads', 'CONTEXTO_IA_VENTAS_HIERBA_SANA.txt'),
    'utf-8',
  );
  const businessContext = `Negocio: Hierba Sana (rubro: productos naturales).\n${contexto}`;

  const historial: MensajeConversacion[] = [];
  let tokens = 0;

  for (const mensaje of GUION) {
    historial.push({ role: 'user', content: mensaje });
    const ejecutor = (
      processor as unknown as {
        crearEjecutor: (
          e: number,
          c: number,
          t: string,
          f: Set<number>,
        ) => (n: string, a: Record<string, unknown>) => Promise<unknown>;
      }
    ).crearEjecutor(EMPRESA_ID, conv.id, TELEFONO, new Set());

    console.log(`\n━━━ cliente: ${mensaje}`);
    try {
      const res = await ia.generarRespuesta(
        historial,
        businessContext,
        historial.length,
        ejecutor,
      );
      for (const ll of res.llamadas) {
        console.log(
          `  → ${ll.nombre}(${JSON.stringify(ll.argumentos).slice(0, 110)})`,
        );
        console.log(`      ⇒ ${JSON.stringify(ll.resultado).slice(0, 220)}`);
      }
      if (!res.llamadas.length) console.log('  → (ninguna herramienta)');
      console.log(`  asistente: ${res.reply.replace(/\n/g, '\n             ')}`);
      historial.push({ role: 'assistant', content: res.reply });
      tokens += res.uso?.entrada ?? 0;
    } catch (e) {
      console.log(`  ✗ ${(e as Error).message.slice(0, 200)}`);
      break;
    }
    await esperar(PAUSA_MS);
  }

  const borrador = await prisma.leadPedidoBorrador.findUnique({
    where: { conversacionId: conv.id },
  });
  console.log('\n═══ Cómo quedó el borrador ═══');
  console.log(
    JSON.stringify(
      {
        zona: borrador?.zona,
        lugar: borrador?.lugar,
        costoEnvio: borrador?.costoEnvio,
        nombre: borrador?.nombre,
        direccion: borrador?.direccion,
        referencia: borrador?.referencia,
        horario: borrador?.horario,
        celular: borrador?.celular,
        items: borrador?.itemsJson,
        pedidoRegistrado: borrador?.comprobanteId,
      },
      null,
      1,
    ),
  );
  console.log(`\nTokens de entrada en toda la conversación: ${tokens}`);

  await prisma.leadConversacion.deleteMany({ where: { id: conv.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
