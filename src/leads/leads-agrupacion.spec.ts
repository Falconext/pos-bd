/**
 * A2 — una sola respuesta para los mensajes que el cliente manda seguidos.
 *
 * El banco de pruebas de Hierba Sana marca como error crítico que el bot
 * conteste tres veces a "hola" / "tienen berberina?" / "y cuánto cuesta". Lo
 * que se valida aquí: que los tres mensajes se guarden, que programen UNA sola
 * respuesta (mismo id de trabajo), que esa respuesta los lea todos, y que no
 * se conteste dos veces al mismo lote.
 */
// @nestjs/bullmq se publica como ESM y Jest no transforma node_modules: sin
// este doble, el import del processor revienta antes de empezar. Solo aporta
// el decorador y la clase base; la cola real llega por el constructor.
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';
import { DEBOUNCE_RESPUESTA_MS, JOB_RESPONDER } from './leads.constants';

const EMPRESA = 89;
const CONV = 42;
const TELEFONO = '51987654321';

type Mensaje = { rol: 'USUARIO' | 'ASISTENTE'; contenido: string };

function armar(opts: { mensajes?: Mensaje[]; botActivo?: boolean } = {}) {
  const mensajes = opts.mensajes ?? [];
  let proximoId = 100;

  const prisma: any = {
    empresa: {
      findFirst: jest.fn().mockResolvedValue({
        id: EMPRESA,
        iaVentasActiva: true,
      }),
      findUnique: jest.fn().mockResolvedValue({
        id: EMPRESA,
        razonSocial: 'HIERBA SANA COMPANY E.I.R.L.',
        nombreComercial: 'Hierba Sana',
        descripcionTienda: null,
        iaVentasActiva: true,
        iaVentasContexto: null,
        iaVentasBrochureUrl: null,
        iaVentasCotizacion: false,
        rubro: null,
        plan: { maxLeadsMes: null },
      }),
    },
    leadConversacion: {
      upsert: jest.fn().mockResolvedValue({ id: CONV }),
      findUnique: jest.fn().mockResolvedValue({
        id: CONV,
        creadoEn: new Date(),
        telefonoProspecto: TELEFONO,
        nombreProspecto: 'Juan',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    leadProspecto: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest
        .fn()
        .mockResolvedValue({ botActivo: opts.botActivo ?? true }),
      update: jest.fn().mockResolvedValue({}),
    },
    leadMensaje: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue(mensajes),
      create: jest.fn().mockImplementation(({ data }: any) => {
        mensajes.push({ rol: data.rol, contenido: data.contenido });
        return Promise.resolve({ id: proximoId++ });
      }),
    },
    producto: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const ia: any = {
    disponible: () => true,
    generarRespuesta: jest.fn().mockResolvedValue({
      reply: 'Sí, tenemos Berberina a S/ 45.00.',
      calificacion: null,
      debeAnalizar: false,
      llamadas: [],
    }),
  };
  const rag: any = { buscarContexto: jest.fn().mockResolvedValue('') };
  const whatsapp: any = {
    enviarTexto: jest.fn().mockResolvedValue({ success: true }),
  };
  const queue: any = { add: jest.fn().mockResolvedValue({}) };

  const processor = new LeadsMessageProcessor(
    prisma,
    ia,
    rag,
    whatsapp,
    {} as any,
    {} as any,
    {} as any,
    queue,
  );
  return { processor, prisma, ia, whatsapp, queue, mensajes };
}

const entrante = (messageId: string, text: string) => ({
  name: 'incoming',
  data: {
    phoneNumberId: '123',
    from: TELEFONO,
    messageId,
    text,
    esAudio: false,
    nombre: 'Juan',
  },
});

describe('tres mensajes seguidos programan una sola respuesta', () => {
  it('guarda los tres y encola siempre el mismo trabajo de respuesta', async () => {
    const { processor, queue, prisma } = armar();

    await processor.process(entrante('wamid.1', 'hola') as any);
    await processor.process(entrante('wamid.2', 'tienen berberina?') as any);
    await processor.process(entrante('wamid.3', 'y cuanto cuesta') as any);

    // Los tres mensajes se guardan: agrupar la respuesta no puede costar
    // mensajes del cliente.
    expect(prisma.leadMensaje.create).toHaveBeenCalledTimes(3);

    // Y las tres veces se encola con el MISMO id: BullMQ descarta el duplicado
    // mientras haya uno esperando, así que solo se responde una vez.
    expect(queue.add).toHaveBeenCalledTimes(3);
    const ids = queue.add.mock.calls.map((c: any[]) => c[2].jobId);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(`resp-${EMPRESA}-${CONV}`);
  });

  it('el trabajo de respuesta se borra al terminar, pase lo que pase', async () => {
    // Si el id quedara retenido en completados o fallidos, esta conversación
    // no volvería a recibir respuesta nunca más.
    const { processor, queue } = armar();
    await processor.process(entrante('wamid.1', 'hola') as any);

    const [nombre, , opciones] = queue.add.mock.calls[0];
    expect(nombre).toBe(JOB_RESPONDER);
    expect(opciones.delay).toBe(DEBOUNCE_RESPUESTA_MS);
    expect(opciones.removeOnComplete).toBe(true);
    expect(opciones.removeOnFail).toBe(true);
  });
});

describe('la respuesta lee todo el lote', () => {
  const tarea = {
    name: JOB_RESPONDER,
    data: { empresaId: EMPRESA, conversacionId: CONV },
  };

  it('contesta una vez a los tres mensajes, con los tres en el historial', async () => {
    const { processor, ia, whatsapp } = armar({
      mensajes: [
        { rol: 'USUARIO', contenido: 'hola' },
        { rol: 'USUARIO', contenido: 'tienen berberina?' },
        { rol: 'USUARIO', contenido: 'y cuanto cuesta' },
      ],
    });

    await processor.process(tarea as any);

    expect(ia.generarRespuesta).toHaveBeenCalledTimes(1);
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
    const historial = ia.generarRespuesta.mock.calls[0][0];
    expect(historial.map((m: any) => m.content)).toEqual([
      'hola',
      'tienen berberina?',
      'y cuanto cuesta',
    ]);
  });

  it('busca productos con el lote entero, no solo con el último mensaje', async () => {
    // "y cuanto cuesta" por sí solo no nombra ningún producto: si la búsqueda
    // mirara solo el último mensaje, el modelo se quedaría sin catálogo.
    const { processor, prisma } = armar({
      mensajes: [
        { rol: 'USUARIO', contenido: 'tienen berberina?' },
        { rol: 'USUARIO', contenido: 'y cuanto cuesta' },
      ],
    });

    await processor.process(tarea as any);

    const where = prisma.producto.findMany.mock.calls[0][0].where;
    const tokens = where.AND.map(
      (c: any) => c.OR[0].descripcion.contains as string,
    );
    expect(tokens).toContain('berberina');
  });

  it('no contesta si lo último de la conversación ya es nuestro', async () => {
    // Reintento de BullMQ, o alguien respondió a mano desde el panel mientras
    // el trabajo esperaba.
    const { processor, ia, whatsapp } = armar({
      mensajes: [
        { rol: 'USUARIO', contenido: 'hola' },
        { rol: 'ASISTENTE', contenido: '¿en qué te ayudo?' },
      ],
    });

    await processor.process(tarea as any);

    expect(ia.generarRespuesta).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('no contesta si un humano tomó el chat', async () => {
    const { processor, ia, whatsapp } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'hola' }],
      botActivo: false,
    });

    await processor.process(tarea as any);

    expect(ia.generarRespuesta).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });
});
