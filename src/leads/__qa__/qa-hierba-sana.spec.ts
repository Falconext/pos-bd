/**
 * QA funcional sobre la empresa real, con la base real.
 *
 * A diferencia de `qa-asesor.spec.ts` —que prueba la plantilla con un
 * catálogo de juguete— acá se arma el turno exactamente como lo arma el
 * procesador en producción: el contexto sale del `iaVentasContexto` guardado
 * en la base, los productos salen del catálogo vivo de la empresa, las fichas
 * salen del RAG y las herramientas son las de verdad. Lo único que no corre
 * es el envío por WhatsApp.
 *
 * Es lo que hay que correr después de tocar el contexto de un cliente desde
 * el panel: el prompt puede estar perfecto y el contexto contradecirlo, que
 * es justo lo que pasaba con el registro sanitario.
 *
 *   QA_IA=1 QA_EMPRESA=89 npx jest src/leads/__qa__/qa-hierba-sana.spec.ts
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { PrismaService } from '../../prisma/prisma.service';
import { GeminiService } from '../../gemini/gemini.service';
import { IaVentasService } from '../leads-ia.service';
import { RagVentasService } from '../leads-rag.service';
import { LeadsMessageProcessor } from '../leads-message.processor';
import { HERRAMIENTA_DERIVAR } from '../leads-herramientas';

const correr = process.env.QA_IA === '1' ? describe : describe.skip;
const EMPRESA_ID = Number(process.env.QA_EMPRESA ?? 89);
const TELEFONO_QA = '51900000001';

correr('QA en vivo sobre la empresa real', () => {
  jest.setTimeout(300_000);

  let prisma: PrismaService;
  let ia: IaVentasService;
  let processor: LeadsMessageProcessor;
  let conversacionId: number;
  let empresa: any;
  /** Avisos de derivación que se HABRÍAN mandado por WhatsApp. */
  const avisos: any[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const gemini = new GeminiService({
      get: (k: string) => process.env[k],
    } as never);
    ia = new IaVentasService(gemini);
    const rag = new RagVentasService(prisma, gemini);

    empresa = await prisma.empresa.findUnique({
      where: { id: EMPRESA_ID },
      select: {
        id: true,
        razonSocial: true,
        nombreComercial: true,
        descripcionTienda: true,
        iaVentasContexto: true,
        rubro: { select: { nombre: true } },
      },
    });
    if (!empresa) throw new Error(`No existe la empresa ${EMPRESA_ID}`);

    // Conversación desechable: el ejecutor real registra consultas y etapas,
    // y no se puede ensuciar una conversación de verdad con un QA.
    const conv = await prisma.leadConversacion.create({
      data: {
        empresaId: EMPRESA_ID,
        telefonoProspecto: TELEFONO_QA,
        nombreProspecto: 'QA interno',
      },
      select: { id: true },
    });
    conversacionId = conv.id;

    const nada = {} as never;
    processor = new LeadsMessageProcessor(
      prisma,
      ia,
      rag,
      nada, // whatsapp: no se envía nada
      { notificarAdminsEmpresa: async () => ({}) } as never,
      // El aviso NO se manda de verdad: el 955947892 es el celular del
      // supervisor de Hierba Sana y un QA no puede escribirle.
      {
        avisarDerivacion: async (p: unknown) => {
          avisos.push(p);
        },
      } as never,
      nada,
      {
        // Dobles del flujo de pedido: lo que se prueba acá es qué DICE el
        // asesor, no el cálculo del pedido (eso ya tiene sus propios tests).
        guardarDatos: async (_e: number, _c: number, _t: string, datos: any) => ({
          guardado: true,
          destino: datos?.destino ?? null,
          zona: datos?.destino ? 'LIMA' : null,
          costoEnvio: datos?.destino ? 15 : null,
          falta: ['nombre', 'dni', 'direccion', 'referencia', 'celular', 'horario'],
        }),
        cotizar: async () => ({
          texto:
            'Te adjunto la Cotización 📋\n(cotización calculada por el sistema)',
        }),
        registrarPedido: async () => ({ registrado: true }),
        // La configuración SÍ sale de la base: es lo que decide a qué número
        // se avisa al derivar y qué teléfonos quedan fuera del embudo, y un
        // doble que la invente no probaría nada.
        configDe: async () => {
          const e = await prisma.empresa.findUnique({
            where: { id: EMPRESA_ID },
            select: { iaVentasConfigJson: true },
          });
          return { ...((e?.iaVentasConfigJson as object) ?? {}) };
        },
      } as never,
      { marcar: async () => undefined } as never,
      { registrar: async () => undefined } as never,
      { programar: async () => undefined } as never,
      nada,
    );
  });

  afterAll(async () => {
    if (conversacionId) {
      await prisma.leadMensaje
        .deleteMany({ where: { conversacionId } })
        .catch(() => undefined);
      await prisma.leadProspecto
        .deleteMany({ where: { conversacionId } })
        .catch(() => undefined);
      await prisma.leadConversacion
        .delete({ where: { id: conversacionId } })
        .catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  /** Replica el armado del turno de `procesarLote`, sin el envío. */
  async function responder(
    historial: { role: 'user' | 'assistant'; content: string }[],
  ) {
    const ultimo = [...historial].reverse().find((m) => m.role === 'user')!;
    const p = processor as any;
    const contextoEmpresa = p.construirContexto(empresa);
    const relevantes = await p.buscarProductosRelevantes(
      EMPRESA_ID,
      ultimo.content,
    );
    const contextoRag = await p.rag.buscarContexto(
      EMPRESA_ID,
      ultimo.content,
      5,
    );
    const businessContext = [contextoEmpresa, relevantes.contexto, contextoRag]
      .filter((s: string) => s && s.trim())
      .join('\n\n');

    const ejecutor = p.crearEjecutor(
      EMPRESA_ID,
      conversacionId,
      TELEFONO_QA,
      new Set(),
    );
    const res = await ia.generarRespuesta(
      historial,
      businessContext,
      historial.length,
      ejecutor,
      {
        nombre: empresa.nombreComercial || empresa.razonSocial,
        rubro: empresa.rubro?.nombre ?? null,
        asesor: 'Claudio',
        contexto: businessContext,
      },
    );
    const usadas = res.llamadas.map((l: any) => l.nombre ?? l.name);
    return { texto: res.reply, usadas };
  }

  it('CASO 1 — registro sanitario: responde y sigue vendiendo', async () => {
    const { texto, usadas } = await responder([
      { role: 'user', content: 'Hola, quiero moringa en cápsulas' },
      {
        role: 'assistant',
        content:
          'Hola, soy Claudio de Hierba Sana 😊 Tenemos moringa en cápsulas. ¿Para qué distrito sería la entrega?',
      },
      {
        role: 'user',
        content:
          '¿Y eso tiene registro sanitario? No quiero comprar cualquier cosa',
      },
    ]);
    console.log('\n[CASO 1]', texto, '\nherramientas:', usadas);
    expect(usadas).not.toContain(HERRAMIENTA_DERIVAR);
    expect(texto.toLowerCase()).toMatch(/registro sanitario/);
  });

  it('CASO 2 — desconfianza "¿no serán falsos?": se defiende', async () => {
    const { texto, usadas } = await responder([
      { role: 'user', content: 'Cuánto está el omega 3' },
      { role: 'assistant', content: 'Te cuento los precios que tenemos.' },
      {
        role: 'user',
        content:
          'Oye y cómo sé que no son productos falsificados? Hay mucha estafa por WhatsApp',
      },
    ]);
    console.log('\n[CASO 2]', texto, '\nherramientas:', usadas);
    expect(usadas).not.toContain(HERRAMIENTA_DERIVAR);
    // La respuesta oficial del negocio: trayectoria, tienda física, RUC.
    expect(texto).toMatch(/20610516158|Emancipaci|contraentrega|a[ñn]os/i);
  });

  it('CASO 3 — con el producto YA decidido, ofrece UN complemento', async () => {
    // El producto principal tiene que estar cerrado: si el cliente todavía no
    // eligió nada, lo que el asesor proponga es la recomendación principal y
    // no prueba nada sobre el complemento.
    const { texto, usadas } = await responder([
      {
        role: 'user',
        content: 'Hola, tengo el colesterol alto y quiero algo natural',
      },
      {
        role: 'assistant',
        content:
          'Hola, soy Claudio de Hierba Sana 😊 ¿Hace cuánto te detectaron el colesterol alto?',
      },
      { role: 'user', content: 'Hace 3 meses' },
      {
        role: 'assistant',
        content:
          'Para el colesterol tenemos el *Colesterol - NATURAL MEDIX (100 cápsulas)* a S/ 30.00. ¿Para qué distrito sería la entrega?',
      },
      { role: 'user', content: 'Ese me llevo. Para Surco' },
    ]);
    console.log('\n[CASO 3]', texto, '\nherramientas:', usadas);
    // Propone algo más y lo pregunta.
    expect(texto).toMatch(/agreg|acompañ|sumar|incluy|complement/i);

    // Y lo que propone tiene que EXISTIR en el catálogo de la empresa y no
    // ser el producto que ya eligió. Comprobarlo contra la base, y no con una
    // lista de nombres escrita acá, es lo único que distingue un complemento
    // de uno inventado: en el QA con catálogo de juguete el modelo se sacó de
    // la manga un "Ajo Sacha" que no existe.
    const delCatalogo = await prisma.producto.findMany({
      where: { empresaId: EMPRESA_ID, estado: 'ACTIVO' },
      select: { descripcion: true },
    });
    const nombrado = delCatalogo
      .map((p) => p.descripcion)
      .filter((d) => d.length > 6 && texto.toLowerCase().includes(d.toLowerCase().slice(0, 18)))
      .filter((d) => !/natural medix/i.test(d));
    expect(nombrado.length).toBeGreaterThanOrEqual(1);
  });

  it('CASO 4 — "solo ese": no vuelve a ofrecer', async () => {
    const { texto } = await responder([
      { role: 'user', content: 'Quiero el psyllium, para Surco' },
      {
        role: 'assistant',
        content:
          'Perfecto. Muchos lo acompañan con un probiótico para mejorar la flora. ¿Te lo agrego?',
      },
      { role: 'user', content: 'No, solo el psyllium nomás' },
    ]);
    console.log('\n[CASO 4]', texto);
    expect(texto).not.toMatch(/¿te (lo|la) agrego|te recomiendo también|also/i);
  });

  it('CASO 5 — mayorista: esto SÍ se sigue derivando', async () => {
    // El riesgo de cerrar la lista de derivación es pasarse de frenada: lo
    // que siempre se derivó tiene que seguir derivándose.
    const { texto, usadas } = await responder([
      {
        role: 'user',
        content:
          'Hola, tengo una botica en Trujillo y quiero comprar al por mayor, unas 10 docenas surtidas. Mi celular es 999888777',
      },
    ]);
    console.log('\n[CASO 5]', texto, '\nherramientas:', usadas);
    // En este primer turno todavía puede no derivar: la regla le pide juntar
    // antes lo que el asesor va a necesitar, porque después de derivar ya no
    // puede preguntar nada.
    expect(texto).toMatch(/mayor|docena|asesor|comercial/i);
  });

  it('CASO 5b — con los datos en la mano, el mayorista SÍ se deriva', async () => {
    // El riesgo de cerrar la lista de motivos es pasarse de frenada: lo que
    // siempre se derivó tiene que seguir derivándose. Este es el turno en el
    // que de verdad toca.
    const { texto, usadas } = await responder([
      {
        role: 'user',
        content:
          'Hola, tengo una botica en Trujillo y quiero comprar al por mayor, unas 10 docenas surtidas',
      },
      {
        role: 'assistant',
        content:
          'Claro, atendemos mayoristas desde 6 docenas surtidas. ¿Me confirmas el nombre de tu botica y tu celular?',
      },
      {
        role: 'user',
        content: 'Botica San Lucas, en Trujillo centro. Mi celular es 999888777',
      },
    ]);
    console.log('\n[CASO 5b]', texto, '\nherramientas:', usadas);
    expect(usadas).toContain(HERRAMIENTA_DERIVAR);

    // Y el supervisor se entera por WhatsApp, no solo por el panel: desde
    // acá la IA deja de responder y el cliente le escribe a nadie.
    const aviso = avisos.at(-1);
    console.log('[CASO 5b] aviso al supervisor:', aviso);
    expect(aviso).toMatchObject({
      empresaId: EMPRESA_ID,
      motivo: 'mayorista',
      supervisorTelefono: '955947892',
    });
    expect(String(aviso.detalle ?? '')).toMatch(/trujillo|botica|docena/i);
  });
});
