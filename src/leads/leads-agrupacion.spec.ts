/**
 * Cuántas veces habla el asistente, y cuándo se calla (A2 y A3).
 *
 * El banco de pruebas de Hierba Sana marca como errores críticos que el bot
 * conteste tres veces a "hola" / "tienen berberina?" / "y cuánto cuesta", y que
 * siga insistiendo después de la despedida. Lo que se valida aquí, sobre el
 * processor entero: que los mensajes seguidos se guarden todos pero programen
 * UNA sola respuesta que los lea todos; que no se conteste dos veces al mismo
 * lote; que no se repita un mensaje equivalente cuando el cliente no aportó
 * nada; y que una despedida clara cierre la conversación, pero un "lo voy a
 * pensar" no.
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

function armar(
  opts: {
    mensajes?: Mensaje[];
    botActivo?: boolean;
    embeddingsPrevios?: number[][];
    textosPrevios?: string[];
    embeddingRespuesta?: number[];
    respuestaIa?: string;
    productos?: any[];
  } = {},
) {
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
      // Dos lecturas distintas sobre la misma tabla: el historial completo y
      // los embeddings de nuestras últimas respuestas.
      findMany: jest.fn().mockImplementation(({ where, select }: any) => {
        if (where?.rol === 'ASISTENTE' && select?.embedding) {
          return Promise.resolve(
            (opts.embeddingsPrevios ?? []).map((embedding, i) => ({
              embedding,
              contenido: opts.textosPrevios?.[i] ?? 'mensaje anterior',
            })),
          );
        }
        return Promise.resolve(mensajes);
      }),
      create: jest.fn().mockImplementation(({ data }: any) => {
        mensajes.push({ rol: data.rol, contenido: data.contenido });
        return Promise.resolve({ id: proximoId++ });
      }),
    },
    producto: { findMany: jest.fn().mockResolvedValue(opts.productos ?? []) },
  };

  const ia: any = {
    disponible: () => true,
    generarEmbedding: jest
      .fn()
      .mockResolvedValue(opts.embeddingRespuesta ?? [1, 0, 0]),
    generarRespuesta: jest.fn().mockResolvedValue({
      reply: opts.respuestaIa ?? 'Sí, tenemos Berberina a S/ 45.00.',
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

describe('no repetirse ni insistir tras la despedida (A3)', () => {
  const tarea = {
    name: JOB_RESPONDER,
    data: { empresaId: EMPRESA, conversacionId: CONV },
  };

  it('calla si el cliente solo dio las gracias y la respuesta repetiría otra', async () => {
    const { processor, whatsapp, prisma } = armar({
      mensajes: [
        { rol: 'USUARIO', contenido: 'tienen berberina?' },
        {
          rol: 'ASISTENTE',
          contenido: 'Quedo atento para completar tu pedido.',
        },
        { rol: 'USUARIO', contenido: 'gracias' },
      ],
      respuestaIa: 'Estoy aquí para ayudarte a finalizar tu compra.',
      embeddingRespuesta: [1, 0, 0],
      embeddingsPrevios: [[0.99, 0.05, 0]],
      textosPrevios: ['Quedo atento para completar tu pedido.'],
    });

    await processor.process(tarea as any);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    expect(prisma.leadMensaje.create).not.toHaveBeenCalled();
  });

  it('responde igual si el cliente aportó algo nuevo, aunque se parezca', async () => {
    const { processor, whatsapp } = armar({
      mensajes: [
        { rol: 'ASISTENTE', contenido: 'Sí, a S/ 45.00. ¿Te la cotizo?' },
        { rol: 'USUARIO', contenido: 'y tienen moringa tambien?' },
      ],
      embeddingRespuesta: [1, 0, 0],
      embeddingsPrevios: [[1, 0, 0]],
    });

    await processor.process(tarea as any);

    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('responde si la respuesta dice algo distinto, aunque el cliente solo diga ok', async () => {
    // "ok" puede ser un sí al "¿agendamos?": si lo que vamos a decir es nuevo,
    // se manda.
    const { processor, whatsapp } = armar({
      mensajes: [
        { rol: 'ASISTENTE', contenido: '¿Deseas que agendemos tu entrega?' },
        { rol: 'USUARIO', contenido: 'ok' },
      ],
      embeddingRespuesta: [0, 1, 0],
      embeddingsPrevios: [[1, 0, 0]],
    });

    await processor.process(tarea as any);

    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('contesta una vez y cierra la conversación ante una despedida clara', async () => {
    const { processor, whatsapp, prisma } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'gracias por la información' }],
    });

    await processor.process(tarea as any);

    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
    expect(prisma.leadConversacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: 'CERRADA' } }),
    );
  });

  it('no cierra con un "lo voy a pensar"', async () => {
    const { processor, prisma } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'lo voy a pensar' }],
    });

    await processor.process(tarea as any);

    const cierres = prisma.leadConversacion.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.estado === 'CERRADA',
    );
    expect(cierres).toHaveLength(0);
  });

  it('un fallo del embedding no deja al cliente sin respuesta', async () => {
    const { processor, ia, whatsapp } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'gracias' }],
    });
    ia.generarEmbedding.mockRejectedValue(new Error('429 cuota'));

    await processor.process(tarea as any);

    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });
});

describe('una cifra nueva nunca se calla', () => {
  // El coseno solo no distingue dos presentaciones del mismo producto: medido
  // con embeddings reales, "Moringa en cápsulas a S/ 31.00" y "Harina de
  // Moringa a S/ 10.00" dan 0.85, por encima del umbral. Callar la segunda le
  // ocultaría al cliente una opción real.
  it('envía la respuesta si trae un precio que no estaba antes', async () => {
    const { processor, whatsapp } = armar({
      mensajes: [
        {
          rol: 'ASISTENTE',
          contenido: 'Tenemos Moringa en cápsulas a S/ 31.00.',
        },
        { rol: 'USUARIO', contenido: 'gracias' },
      ],
      respuestaIa: 'Tenemos Harina de Moringa de 150 gr a S/ 10.00.',
      embeddingRespuesta: [1, 0, 0],
      embeddingsPrevios: [[1, 0, 0]],
      textosPrevios: ['Tenemos Moringa en cápsulas a S/ 31.00.'],
    });

    await processor.process({
      name: JOB_RESPONDER,
      data: { empresaId: EMPRESA, conversacionId: CONV },
    } as any);

    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('calla si repite el mismo mensaje con las mismas cifras', async () => {
    const { processor, whatsapp } = armar({
      mensajes: [
        {
          rol: 'ASISTENTE',
          contenido: 'Quedo atento para completar tu pedido.',
        },
        { rol: 'USUARIO', contenido: 'gracias' },
      ],
      respuestaIa: 'Estoy aquí para ayudarte a finalizar tu compra.',
      embeddingRespuesta: [1, 0, 0],
      embeddingsPrevios: [[1, 0, 0]],
      textosPrevios: ['Quedo atento para completar tu pedido.'],
    });

    await processor.process({
      name: JOB_RESPONDER,
      data: { empresaId: EMPRESA, conversacionId: CONV },
    } as any);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });
});

describe('lo que la IA ve del catálogo (B1 y B2)', () => {
  const tarea = {
    name: JOB_RESPONDER,
    data: { empresaId: EMPRESA, conversacionId: CONV },
  };

  const producto = (extra: any) => ({
    id: 1,
    descripcion: 'Moringa 100 cápsulas',
    precioUnitario: 31,
    stock: 50,
    moneda: 'PEN',
    imagenUrl: null,
    disponibilidad: null,
    prioridadVenta: null,
    ...extra,
  });

  const contextoDe = (ia: any) =>
    ia.generarRespuesta.mock.calls[0][1] as string;

  it('nunca le pasa un número de stock', async () => {
    // Hierba Sana no lleva inventario: su stock es ficticio y decir "quedan
    // 50" es prometer algo que nadie sabe.
    const { processor, ia } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      productos: [producto({ stock: 50 })],
    });

    await processor.process(tarea as any);

    expect(contextoDe(ia)).not.toContain('stock 50');
    expect(contextoDe(ia)).toContain('disponible');
  });

  it('dice "bajo pedido" sin prometer fecha', async () => {
    const { processor, ia } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      productos: [producto({ disponibilidad: 'BAJO_PEDIDO' })],
    });

    await processor.process(tarea as any);

    const contexto = contextoDe(ia);
    expect(contexto).toContain('bajo pedido');
    expect(contexto).toContain('sin fecha prometida');
  });

  it('lo puesto a mano manda sobre el stock', async () => {
    const { processor, ia } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      // Stock 50 pero marcado como no disponible: gana el campo.
      productos: [producto({ disponibilidad: 'NO_DISPONIBLE', stock: 50 })],
    });

    await processor.process(tarea as any);

    expect(contextoDe(ia)).toContain('no disponible');
  });

  it('pone lo que se entrega ya por delante de lo que hay que encargar', async () => {
    const { processor, ia } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      productos: [
        producto({
          id: 1,
          descripcion: 'Moringa encargo',
          disponibilidad: 'BAJO_PEDIDO',
        }),
        producto({
          id: 2,
          descripcion: 'Moringa a la mano',
          disponibilidad: 'INMEDIATA',
        }),
      ],
    });

    await processor.process(tarea as any);

    const contexto = contextoDe(ia);
    expect(contexto.indexOf('Moringa a la mano')).toBeLessThan(
      contexto.indexOf('Moringa encargo'),
    );
  });

  it('pide a la base que ordene por prioridad de venta', async () => {
    const { processor, prisma } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      productos: [producto({})],
    });

    await processor.process(tarea as any);

    const orderBy = prisma.producto.findMany.mock.calls[0][0].orderBy;
    expect(orderBy[0]).toEqual({
      prioridadVenta: { sort: 'desc', nulls: 'last' },
    });
  });
});
