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
  const prisma = {
    leadProspecto: {
      updateMany: jest.fn(({ data }: any) => {
        pausas.push(data);
        return Promise.resolve({ count: 1 });
      }),
    },
  } as never;
  const pedido = {
    registrarPedido: jest.fn().mockResolvedValue(resultadoRegistrar),
  } as never;
  const notificaciones = {
    notificarAdminsEmpresa: jest.fn().mockResolvedValue({}),
  } as never;

  const processor = new LeadsMessageProcessor(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    notificaciones,
    {} as never,
    {} as never,
    pedido,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const ejecutor = (processor as any).crearEjecutor(89, 52, '51999', new Set());
  return { ejecutor, pausas };
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
