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
    config?: Record<string, unknown>;
  } = {},
) {
  const mensajes = opts.mensajes ?? [];
  let proximoId = 100;

  const prisma: any = {
    numeroWhatsapp: { findUnique: jest.fn().mockResolvedValue(null) },
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
        // La pausa de la IA vive en la conversación (antes en el prospecto):
        // así también se puede tomar un chat de prueba, que no tiene uno.
        botActivo: opts.botActivo ?? true,
        pausadoHasta: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    leadProspecto: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    leadMensaje: {
      findUnique: jest.fn().mockResolvedValue(null),
      // ¿Ya se mandó el descargo en esta conversación? En estas pruebas, no.
      findFirst: jest.fn().mockResolvedValue(null),
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
    // Sin pedido registrado: una respuesta que diga "quedó registrado" se corrige.
    leadPedidoBorrador: { findUnique: jest.fn().mockResolvedValue(null) },
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

  const pedido: any = {
    configDe: jest.fn().mockResolvedValue({
      envio: { zonas: [], zonaPorDefecto: '' },
      horario: {},
      descuento: {
        precioUnitarioMinimo: 20,
        envioCuentaEnTotal: true,
        tramos: [],
      },
      ...(opts.config ?? {}),
    }),
    guardarDatos: jest.fn().mockResolvedValue({ guardado: [], faltan: [] }),
    cotizar: jest.fn().mockResolvedValue({ texto: 'cotización' }),
    registrarPedido: jest.fn().mockResolvedValue({ registrado: true }),
  };
  const consultas: any = consultasFalsas();
  const disparadores: any = disparadoresFalsos();
  const notificaciones: any = {
    notificarAdminsEmpresa: jest.fn().mockResolvedValue({}),
  };
  const alerta: any = { avisarAltoRiesgo: jest.fn().mockResolvedValue(undefined) };
  const processor = new LeadsMessageProcessor(
    prisma,
    ia,
    rag,
    whatsapp,
    notificaciones,
    alerta,
    {} as any,
    pedido,
    embudoFalso(),
    consultas,
    disparadores,
    queue,
  );
  return { processor, prisma, ia, whatsapp, queue, pedido, mensajes, alerta, consultas, disparadores };
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

  it('si el cliente escribe mientras se responde, no manda la respuesta vieja y vuelve a responder', async () => {
    // Prueba del 19-10: los datos de envío llegaron con el trabajo en curso,
    // su id ocupado, y nadie los contestó.
    const { processor, prisma, whatsapp, queue } = armar({
      mensajes: [{ id: 7, rol: 'USUARIO', contenido: 'quiero 1 gastrizan' } as any],
    });
    prisma.leadMensaje.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.id?.gt === 7 && where?.rol === 'USUARIO' ? 1 : 0),
    );

    await processor.process(tarea as any);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    const [nombre, , opciones] = queue.add.mock.calls.at(-1);
    expect(nombre).toBe(JOB_RESPONDER);
    expect(opciones.jobId).toBe(`resp-${EMPRESA}-${CONV}-tras-7`);
    expect(opciones.removeOnComplete).toBe(true);
  });

  it('cliente de alto riesgo: indicación médica y aviso aunque el modelo los olvide', async () => {
    // 19-10 en prod: el mismo mensaje salió una vez bien y otra sin nada.
    const { processor, whatsapp, alerta } = armar({
      mensajes: [
        {
          rol: 'USUARIO',
          contenido:
            'tengo diabetes, soy hipertenso y tomo metformina y losartán, ¿qué puedo tomar?',
        },
      ],
      respuestaIa: 'Tenemos Diabetizan - Natural Medix a S/ 30. ¿Te lo agrego?',
    });

    await processor.process(tarea as any);

    const enviado = whatsapp.enviarTexto.mock.calls[0][1];
    expect(enviado).toMatch(/consúltalo con tu médico/);
    expect(enviado).toMatch(/no dejes tu tratamiento/);
    expect(alerta.avisarAltoRiesgo).toHaveBeenCalledTimes(1);
  });

  it('producto agotado: queda en lista de espera aunque el modelo no use la herramienta', async () => {
    // 19-10: "agotado... te aviso apenas llegue" y nadie quedó anotado.
    const { processor, consultas } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'quiero el purificador de sangre natural medix' }],
      productos: [
        { id: 31403, descripcion: 'Purificador de sangre - NATURAL MEDIX ( 100 capsulas )', precioUnitario: 31, stock: 0, moneda: 'PEN', disponibilidad: null },
      ],
      respuestaIa: 'Está agotado por ahora, te aviso apenas llegue.',
    });
    await processor.process(tarea as any);
    expect(consultas.registrar).toHaveBeenCalledTimes(1);
    const [, , , filas] = consultas.registrar.mock.calls[0];
    expect(filas[0]).toMatchObject({ productoId: 31403, hubo: false, disponibilidad: 'NO_DISPONIBLE' });
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

  it('respuesta vacía de la IA: no manda un mensaje vacío, reintenta (QA 20-10)', async () => {
    const { processor, ia, whatsapp } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'mejor quiero dos, ya no una' }],
    });
    ia.generarRespuesta.mockResolvedValue({ reply: '', llamadas: [] });

    await expect(processor.process(tarea as any)).rejects.toThrow(/respuesta vacía/);
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('respuesta vacía tras cotizar: manda la cotización y que el pedido se actualizó', async () => {
    const { processor, ia, whatsapp, prisma } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'mejor quiero dos, ya no una' }],
    });
    ia.generarRespuesta.mockResolvedValue({
      reply: '',
      llamadas: [
        {
          nombre: 'cotizar',
          argumentos: {},
          resultado: { texto: 'Te adjunto la Cotización 📋 *Tu pedido*\n*TOTAL: S/ 24.00*', pedidoActualizado: 'NV01-00000015' },
        },
      ],
    });

    await processor.process(tarea as any);

    const enviado = whatsapp.enviarTexto.mock.calls[0][1];
    expect(enviado).toContain('*TOTAL: S/ 24.00*');
    expect(enviado).toContain('NV01-00000015 quedó actualizado');
    // Y no se cierra la conversación: cambiar el pedido no es despedirse.
    expect(prisma.leadConversacion.update).not.toHaveBeenCalledWith(
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

  // Lo fijo del negocio (arg 1) y lo de este mensaje (arg 5): el catálogo
  // viaja en el segundo para no romper el caché del prompt.
  const contextoDe = (ia: any) =>
    `${ia.generarRespuesta.mock.calls[0][1] ?? ''}\n${ia.generarRespuesta.mock.calls[0][5] ?? ''}`;

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

  it('dice "bajo reserva" sin prometer fecha', async () => {
    const { processor, ia } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      productos: [producto({ disponibilidad: 'BAJO_PEDIDO' })],
    });

    await processor.process(tarea as any);

    const contexto = contextoDe(ia);
    expect(contexto).toContain('bajo reserva');
    expect(contexto).toContain('sin fecha prometida');
  });

  it('lo puesto a mano manda sobre el stock', async () => {
    const { processor, ia } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      // Stock 50 pero marcado como no disponible: gana el campo.
      productos: [producto({ disponibilidad: 'NO_DISPONIBLE', stock: 50 })],
    });

    await processor.process(tarea as any);

    // El texto dice "agotado" desde que se distinguió de "descontinuado":
    // agotado puede volver y se avisa; descontinuado no.
    expect(contextoDe(ia)).toContain('agotado');
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

describe('el descargo legal lo pone el código, no el modelo (C5)', () => {
  const tarea = {
    name: JOB_RESPONDER,
    data: { empresaId: EMPRESA, conversacionId: CONV },
  };
  const DESCARGO = 'No reemplaza el tratamiento médico profesional.';

  const conLlamadas = (
    llamadas: any[],
    extra: Record<string, unknown> = {},
  ) => {
    const h = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'algo para la gastritis' }],
      respuestaIa: 'Te recomiendo la Moringa a S/ 31.00.',
      config: { descargoLegal: DESCARGO },
      ...extra,
    });
    h.ia.generarRespuesta.mockResolvedValue({
      reply: 'Te recomiendo la Moringa a S/ 31.00.',
      calificacion: null,
      debeAnalizar: false,
      llamadas,
      uso: null,
    });
    return h;
  };

  const enviado = (whatsapp: any) => whatsapp.enviarTexto.mock.calls[0][1];

  it('lo añade cuando el turno recomendó productos', async () => {
    const { processor, whatsapp } = conLlamadas([
      {
        nombre: 'buscar_productos',
        argumentos: {},
        resultado: { productos: [{ id: 1 }] },
      },
    ]);

    await processor.process(tarea as any);

    expect(enviado(whatsapp)).toContain(DESCARGO);
  });

  it('NO lo añade en una pregunta comercial', async () => {
    // "¿dónde están ubicados?" no lleva descargo médico.
    const { processor, whatsapp } = conLlamadas([]);

    await processor.process(tarea as any);

    expect(enviado(whatsapp)).not.toContain(DESCARGO);
  });

  it('no lo añade si la búsqueda no encontró nada', async () => {
    const { processor, whatsapp } = conLlamadas([
      {
        nombre: 'buscar_productos',
        argumentos: {},
        resultado: { productos: [] },
      },
    ]);

    await processor.process(tarea as any);

    expect(enviado(whatsapp)).not.toContain(DESCARGO);
  });

  it('sin descargo configurado, la respuesta sale tal cual', async () => {
    const { processor, whatsapp } = conLlamadas(
      [
        {
          nombre: 'buscar_productos',
          argumentos: {},
          resultado: { productos: [{ id: 1 }] },
        },
      ],
      { config: {} },
    );

    await processor.process(tarea as any);

    expect(enviado(whatsapp)).toBe('Te recomiendo la Moringa a S/ 31.00.');
  });
});

/**
 * El embudo y el registro de consultas no son lo que estos tests miden, pero
 * el processor los necesita. Devuelven lo mínimo para que no estorben.
 */
function embudoFalso() {
  return {
    mover: async () => ({ movido: true }),
    registrarComprobantePago: async () => ({ registrado: false }),
  } as never;
}

/** Los disparadores no son lo que estos tests miden: no estorban. */
function disparadoresFalsos() {
  return {
    programar: jest.fn(async () => ({ programado: true })),
    cancelar: async () => ({ cancelados: 0 }),
    atenderSiEsBaja: async () => ({ eraBaja: false }),
  } as never;
}

function consultasFalsas() {
  return {
    registrar: jest.fn(async () => 0),
    historialDe: async () => ({ malestares: [], productos: [], noHabidos: [] }),
  } as never;
}

describe('el prompt de sistema no cambia entre mensajes (caché de Gemini)', () => {
  const tarea = { name: JOB_RESPONDER, data: { empresaId: EMPRESA, conversacionId: CONV } };

  it('el catálogo del turno va aparte, no en el contexto fijo', async () => {
    const { processor, ia } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'tienen moringa?' }],
      productos: [{ id: 1, descripcion: 'Moringa 100 cápsulas', precioUnitario: 30, stock: 5, moneda: 'PEN' }],
    });
    await processor.process(tarea as any);
    const [, fijo, , , , delTurno] = ia.generarRespuesta.mock.calls[0];
    expect(fijo).not.toMatch(/Moringa/);
    expect(delTurno).toMatch(/Moringa/);
  });
});

describe('el cliente dice cuándo retoma y el modelo no lo agenda', () => {
  const tarea = { name: JOB_RESPONDER, data: { empresaId: EMPRESA, conversacionId: CONV } };

  it('19-10: "cobro a fin de mes y ahí te escribo" queda agendado igual', async () => {
    const { processor, disparadores } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'ahorita no tengo plata, cobro a fin de mes y ahí te escribo para comprarlo' }],
      respuestaIa: '¡Perfecto! A fin de mes te estaré escribiendo.',
    });
    await processor.process(tarea as any);
    const llamadas = disparadores.programar.mock.calls.map((c: any[]) => c[0]);
    const r = llamadas.find((d: any) => d.tipo === 'RECORDATORIO_ACORDADO');
    expect(r).toBeDefined();
    expect(r.referencia).toMatch(/^conversacion:\d+:\d{4}-\d{2}-\d{2}$/);
  });

  it('una fecha de entrega no es una postergación', async () => {
    const { processor, disparadores } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'mándamelo el lunes a mi casa' }],
    });
    await processor.process(tarea as any);
    const tipos = disparadores.programar.mock.calls.map((c: any[]) => c[0].tipo);
    expect(tipos).not.toContain('RECORDATORIO_ACORDADO');
  });
});

describe('mensaje que llega justo después de enviar la respuesta', () => {
  const tarea = { name: JOB_RESPONDER, data: { empresaId: EMPRESA, conversacionId: CONV } };

  it('19-10 Krezka: si al terminar lo último es del cliente, se vuelve a responder', async () => {
    const { processor, prisma, queue } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: '¡Hola! Quiero más información' }],
    });
    // Al terminar el turno, ya entró otro mensaje del cliente (id 99).
    prisma.leadMensaje.findFirst = jest.fn(async ({ orderBy }: any) =>
      orderBy ? { id: 99, rol: 'USUARIO' } : null,
    );
    await processor.process(tarea as any);
    const ids = queue.add.mock.calls.map((c: any[]) => c[2]?.jobId);
    expect(ids).toContain(`resp-${EMPRESA}-${CONV}-tras-99`);
  });

  it('si lo último es la respuesta, no reprograma nada', async () => {
    const { processor, prisma, queue } = armar({
      mensajes: [{ rol: 'USUARIO', contenido: 'hola' }],
    });
    prisma.leadMensaje.findFirst = jest.fn(async ({ orderBy }: any) =>
      orderBy ? { id: 100, rol: 'ASISTENTE' } : null,
    );
    await processor.process(tarea as any);
    const ids = queue.add.mock.calls.map((c: any[]) => c[2]?.jobId).filter(Boolean);
    expect(ids.some((i: string) => i.includes('-tras-'))).toBe(false);
  });
});
