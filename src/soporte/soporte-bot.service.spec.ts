/**
 * El asistente decidiendo sobre una conversación real.
 *
 * Complementa a soporte-bot.spec.ts: allá se prueban las reglas puras, acá que
 * el servicio lea bien el hilo —quién contestó último, cuántas veces seguidas
 * habló el bot— y que nunca le cueste el mensaje al empresario.
 */
import { AVISO_ESCALADO, SoporteBotService, NOMBRE_DEL_BOT } from './soporte-bot.service';

const conversacion = (asignadoAId: number | null = null) => ({ asignadoAId });

/** Prisma de mentira: solo lo que el servicio consulta. */
const prismaCon = (opciones: {
  asignadoAId?: number | null;
  mensajes?: { rol: string; autorNombre: string | null; creadoEn: Date; contenido?: string }[];
}) => ({
  soporteConversacion: {
    findUnique: async () => conversacion(opciones.asignadoAId ?? null),
  },
  soporteMensaje: {
    findMany: async () =>
      (opciones.mensajes ?? []).map((m) => ({ contenido: 'x', ...m })),
    // El servicio mira el último mensaje del sistema para no repetir el aviso.
    findFirst: async () =>
      (opciones.mensajes ?? [])
        .map((m) => ({ contenido: 'x', ...m }))
        .find((m) => m.rol === 'SISTEMA') ?? null,
  },
});

const geminiQueResponde = (texto: string) => ({
  isEnabled: () => true,
  chatConHistorial: jest.fn().mockResolvedValue(texto),
});

const configCon = (prendido: boolean) => ({
  get: (k: string) => (k === 'SOPORTE_IA' ? String(prendido) : undefined),
});

const armar = (prisma: any, gemini: any, prendido = true) =>
  new SoporteBotService(prisma as any, gemini as any, configCon(prendido) as any);

const pedir = (servicio: SoporteBotService, mensaje = '¿cómo emito una boleta?') =>
  servicio.responder({ conversacionId: 1, mensaje, marca: 'Krezka', horario: 'x' });

const ahora = () => new Date();
const haceMinutos = (n: number) => new Date(Date.now() - n * 60000);

describe('El asistente está apagado salvo que se prenda', () => {
  it('sin SOPORTE_IA no contesta, aunque haya motor', async () => {
    // Es la garantía de que esto no le cambia el soporte a nadie al desplegarlo.
    const s = armar(prismaCon({}), geminiQueResponde('hola'), false);
    expect(await pedir(s)).toBeNull();
  });

  it('sin GEMINI_API_KEY tampoco', async () => {
    const gemini = { isEnabled: () => false, chatConHistorial: jest.fn() };
    const s = armar(prismaCon({}), gemini);
    expect(await pedir(s)).toBeNull();
    expect(gemini.chatConHistorial).not.toHaveBeenCalled();
  });
});

describe('Contesta cuando no hay nadie más', () => {
  it('responde una consulta con el hilo vacío', async () => {
    const s = armar(prismaCon({ mensajes: [] }), geminiQueResponde('Andá a Comprobantes.'));
    expect(await pedir(s)).toBe('Andá a Comprobantes.');
  });

  it('le pasa el historial al modelo en orden, del más viejo al más nuevo', async () => {
    const gemini = geminiQueResponde('ok');
    const s = armar(
      prismaCon({
        mensajes: [
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(1), contenido: 'segundo' },
          { rol: 'EMPRESA', autorNombre: 'Ana', creadoEn: haceMinutos(2), contenido: 'primero' },
        ],
      }),
      gemini,
    );
    await pedir(s);
    const historial = gemini.chatConHistorial.mock.calls[0][1];
    expect(historial.map((m: any) => m.content)).toEqual(['primero', 'segundo']);
    expect(historial.map((m: any) => m.role)).toEqual(['user', 'model']);
  });
});

describe('Se aparta cuando hay una persona', () => {
  it('no contesta si la conversación está tomada', async () => {
    const gemini = geminiQueResponde('no debería salir');
    const s = armar(prismaCon({ asignadoAId: 9 }), gemini);
    expect(await pedir(s)).toBeNull();
    expect(gemini.chatConHistorial).not.toHaveBeenCalled();
  });

  it('no contesta si alguien del equipo respondió recién', async () => {
    const s = armar(
      prismaCon({
        mensajes: [{ rol: 'SISTEMA', autorNombre: 'Diego', creadoEn: haceMinutos(3) }],
      }),
      geminiQueResponde('no debería salir'),
    );
    expect(await pedir(s)).toBeNull();
  });

  it('vuelve a contestar si esa persona respondió hace rato', async () => {
    const s = armar(
      prismaCon({
        mensajes: [{ rol: 'SISTEMA', autorNombre: 'Diego', creadoEn: haceMinutos(120) }],
      }),
      geminiQueResponde('listo'),
    );
    expect(await pedir(s)).toBe('listo');
  });

  it('sus propios mensajes no cuentan como "una persona respondió"', async () => {
    // Si el bot se leyera a sí mismo como humano, se callaría para siempre
    // apenas contestara una vez.
    const s = armar(
      prismaCon({
        mensajes: [
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(1) },
        ],
      }),
      geminiQueResponde('sigo acá'),
    );
    expect(await pedir(s)).toBe('sigo acá');
  });

  it('sigue contestando tras varias respuestas suyas seguidas', async () => {
    const s = armar(
      prismaCon({
        mensajes: [
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(1) },
          { rol: 'EMPRESA', autorNombre: 'Ana', creadoEn: haceMinutos(2) },
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(3) },
          { rol: 'EMPRESA', autorNombre: 'Ana', creadoEn: haceMinutos(4) },
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(5) },
        ],
      }),
      geminiQueResponde('sigo ayudando'),
    );
    // Tres respuestas buenas seguidas no son motivo para abandonar al
    // empresario: es exactamente el caso que se rompió en la primera prueba.
    expect(await pedir(s)).toBe('sigo ayudando');
  });

  it('la cuenta se reinicia si en el medio contestó una persona', async () => {
    const s = armar(
      prismaCon({
        mensajes: [
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(60) },
          { rol: 'SISTEMA', autorNombre: 'Diego', creadoEn: haceMinutos(90) },
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(100) },
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(110) },
        ],
      }),
      geminiQueResponde('ok'),
    );
    expect(await pedir(s)).toBe('ok');
  });
});

describe('Cuando no puede ayudar, lo dice: nunca silencio', () => {
  // La primera versión escalaba callándose. En la primera prueba real el
  // empresario preguntó algo fuera del conocimiento, no recibió nada, y siguió
  // con "hello?" y "estás ahí?". Desde el otro lado, silencio y sistema roto
  // se ven exactamente igual.

  it('avisa si el modelo pide escalar', async () => {
    const s = armar(prismaCon({}), geminiQueResponde('ESCALAR'));
    expect(await pedir(s)).toBe(AVISO_ESCALADO);
  });

  it('avisa si el modelo devuelve vacío', async () => {
    const s = armar(prismaCon({}), geminiQueResponde('   '));
    expect(await pedir(s)).toBe(AVISO_ESCALADO);
  });

  it('avisa si Gemini se cae, en vez de dejar al empresario esperando', async () => {
    const gemini = {
      isEnabled: () => true,
      chatConHistorial: jest.fn().mockRejectedValue(new Error('503')),
    };
    const s = armar(prismaCon({}), gemini);
    expect(await pedir(s)).toBe(AVISO_ESCALADO);
  });

  it('avisa si le piden una persona, sin gastar una llamada al modelo', async () => {
    const gemini = geminiQueResponde('no debería salir');
    const s = armar(prismaCon({}), gemini);
    expect(await pedir(s, 'quiero hablar con un humano')).toBe(AVISO_ESCALADO);
    expect(gemini.chatConHistorial).not.toHaveBeenCalled();
  });

  it('no repite el aviso si ya lo dio', async () => {
    // Repetirlo en cada mensaje sería tan molesto como el silencio.
    const s = armar(
      prismaCon({
        mensajes: [
          { rol: 'SISTEMA', autorNombre: NOMBRE_DEL_BOT, creadoEn: haceMinutos(1), contenido: AVISO_ESCALADO },
        ],
      }),
      geminiQueResponde('ESCALAR'),
    );
    expect(await pedir(s)).toBeNull();
  });

  it('con una persona en la conversación se calla del todo, ni avisa', async () => {
    // Un aviso automático acá se metería en el medio de lo que está hablando.
    const s = armar(prismaCon({ asignadoAId: 9 }), geminiQueResponde('x'));
    expect(await pedir(s)).toBeNull();
  });

  it('tampoco avisa mientras una persona viene respondiendo', async () => {
    const s = armar(
      prismaCon({ mensajes: [{ rol: 'SISTEMA', autorNombre: 'Diego', creadoEn: haceMinutos(3) }] }),
      geminiQueResponde('x'),
    );
    expect(await pedir(s)).toBeNull();
  });
});
