/**
 * Derivar porque el cliente necesita una persona no es lo mismo que derivar
 * porque algo se rompió.
 *
 * Pasó en producción: `registrar_pedido` falló, el modelo derivó a un asesor
 * —razonable— y la derivación dejó el bot apagado SIN vencimiento. El cliente
 * escribió "ya, confirmo" y nadie le respondió nunca más. Nunca había pedido
 * hablar con una persona: solo tuvo la mala suerte de toparse con un error.
 */
// @nestjs/bullmq se publica como ESM y Jest no transforma node_modules: sin
// este doble, el import del processor revienta antes de empezar.
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  InjectQueue: () => () => undefined,
  WorkerHost: class {},
}));

import { LeadsMessageProcessor } from './leads-message.processor';
import { PAUSA_INTERVENCION_MS } from './pausa-bot';
import {
  HERRAMIENTA_DERIVAR,
  HERRAMIENTA_REGISTRAR_PEDIDO,
} from './leads-herramientas';

function armar(resultadoRegistrar: Record<string, unknown>) {
  const pausas: Record<string, unknown>[] = [];
  const avisos: Record<string, unknown>[] = [];
  // La derivación apaga la IA en la conversación (que es lo que mira el
  // processor) y lo refleja en el prospecto (que es lo que pinta el embudo).
  // Ambas escrituras van juntas, así que se recogen las dos en `pausas`.
  const anota = ({ data }: any) => {
    pausas.push(data);
    return Promise.resolve({ count: 1 });
  };
  const prisma = {
    leadProspecto: { updateMany: jest.fn(anota) },
    leadConversacion: {
      update: jest.fn(anota),
      findUnique: jest.fn().mockResolvedValue({ nombreProspecto: 'Diego' }),
    },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  } as never;
  const pedido = {
    registrarPedido: jest.fn().mockResolvedValue(resultadoRegistrar),
    configDe: jest.fn().mockResolvedValue({ supervisorTelefono: '955947892' }),
  } as never;
  const notificaciones = {
    notificarAdminsEmpresa: jest.fn().mockResolvedValue({}),
  } as never;
  const alerta = {
    avisarDerivacion: jest.fn(async (p: Record<string, unknown>) => {
      avisos.push(p);
    }),
  } as never;

  const processor = new LeadsMessageProcessor(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    notificaciones,
    alerta,
    {} as never,
    pedido,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const ejecutor = (processor as any).crearEjecutor(89, 52, '51999', new Set());
  return { ejecutor, pausas, avisos };
}

describe('la pausa que deja una derivación', () => {
  it('cuando el cliente pide una persona, NO vence: hay alguien a cargo', async () => {
    const { ejecutor, pausas } = armar({ registrado: true });
    await ejecutor(HERRAMIENTA_DERIVAR, { motivo: 'mayorista' });
    expect(pausas[0]).toMatchObject({
      botActivo: false,
      pausadoHasta: null,
      motivoPausa: 'mayorista',
    });
  });

  it('cuando algo se rompió, VENCE: el cliente no pidió un humano', async () => {
    const { ejecutor, pausas } = armar({
      error: 'No se pudo registrar el pedido en el sistema.',
    });
    await ejecutor(HERRAMIENTA_REGISTRAR_PEDIDO, {});
    await ejecutor(HERRAMIENTA_DERIVAR, { motivo: 'seguimiento_de_pedido' });

    const p = pausas[0] as { pausadoHasta: Date; motivoPausa: string };
    expect(p.pausadoHasta).toBeInstanceOf(Date);
    const faltan = p.pausadoHasta.getTime() - Date.now();
    expect(faltan).toBeGreaterThan(PAUSA_INTERVENCION_MS - 5000);
    // Y se anota POR QUÉ, para que el equipo no crea que fue el cliente.
    expect(p.motivoPausa).toMatch(/fallo del sistema/i);
  });

  it('"ya estaba registrado" no cuenta como fallo: es la idempotencia', async () => {
    const { ejecutor, pausas } = armar({
      error: 'Este pedido ya estaba registrado. Dile al cliente el número...',
    });
    await ejecutor(HERRAMIENTA_REGISTRAR_PEDIDO, {});
    await ejecutor(HERRAMIENTA_DERIVAR, { motivo: 'reclamo' });
    expect(pausas[0]).toMatchObject({ pausadoHasta: null, motivoPausa: 'reclamo' });
  });

  it('un motivo que el modelo se inventó NO apaga el bot', async () => {
    // Lo reportó el cliente: "sobre el registro sanitario... lo derivó en una
    // al supervisor". Esa derivación apagaba el bot sin vencimiento por una
    // pregunta que el contexto ya sabía contestar.
    const { ejecutor, pausas } = armar({ registrado: true });
    const r = (await ejecutor(HERRAMIENTA_DERIVAR, {
      motivo: 'registro_sanitario',
    })) as { derivado: boolean; instruccion: string };

    expect(pausas).toHaveLength(0);
    expect(r.derivado).toBe(false);
    // Y se le dice qué hacer en su lugar, no solo que no.
    expect(r.instruccion).toMatch(/respóndelo tú/i);
    expect(r.instruccion).toMatch(/no le digas al cliente que lo pasaste/i);
  });

  it('pero un fallo técnico deriva igual, con cualquier motivo', async () => {
    // Acá el modelo no puede seguir aunque la etiqueta no encaje: lo que
    // importa es que esa pausa venza sola.
    const { ejecutor, pausas } = armar({
      error: 'No se pudo registrar el pedido en el sistema.',
    });
    await ejecutor(HERRAMIENTA_REGISTRAR_PEDIDO, {});
    await ejecutor(HERRAMIENTA_DERIVAR, { motivo: 'algo_raro' });
    expect(pausas[0]).toMatchObject({ botActivo: false });
    expect((pausas[0] as any).pausadoHasta).toBeInstanceOf(Date);
  });

  it('avisa por WhatsApp a quien atiende, no solo en el panel', async () => {
    // Derivar apaga el bot: si el único aviso es la notificación in-app y
    // nadie está mirando el panel, el cliente le escribe a nadie.
    const { ejecutor, avisos } = armar({ registrado: true });
    await ejecutor(HERRAMIENTA_DERIVAR, {
      motivo: 'mayorista',
      detalle: 'Botica en Trujillo, 10 docenas',
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      empresaId: 89,
      telefonoProspecto: '51999',
      nombreProspecto: 'Diego',
      motivo: 'mayorista',
      detalle: 'Botica en Trujillo, 10 docenas',
      supervisorTelefono: '955947892',
    });
  });

  it('una derivación rechazada no avisa a nadie', async () => {
    // El motivo inventado no deriva; mandar el aviso igual haría que el
    // supervisor persiguiera a un cliente al que la IA le sigue hablando.
    const { ejecutor, avisos } = armar({ registrado: true });
    await ejecutor(HERRAMIENTA_DERIVAR, { motivo: 'registro_sanitario' });
    expect(avisos).toHaveLength(0);
  });

  it('el fallo de un turno no contamina al siguiente', async () => {
    // Cada turno arma su propio ejecutor: un error de hace tres mensajes no
    // debe cambiar cómo se pausa hoy.
    const a = armar({ error: 'No se pudo registrar el pedido en el sistema.' });
    await a.ejecutor(HERRAMIENTA_REGISTRAR_PEDIDO, {});
    const b = armar({ registrado: true });
    await b.ejecutor(HERRAMIENTA_DERIVAR, { motivo: 'mayorista' });
    expect(b.pausas[0]).toMatchObject({ pausadoHasta: null });
  });
});
